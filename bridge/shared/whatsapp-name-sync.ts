// whatsapp-name-sync — loop de reparo de nome para contatos de QUALQUER canal WhatsApp ativo.
// Portado do hub CECAPE e generalizado: o guard de conta/host usa envAcct() (a conta Chatwoot
// principal do EvoHub) no lugar do accountId/host fixos da CECAPE, e as URLs usam acct.accountId.
//
// Busca o perfil na uazapi (/chat/details), confirma que o contato pertence à inbox esperada
// (anti-contaminação cruzada) e escreve nome+avatar de volta no Chatwoot + espelha no customers.
// Uma escrita por ciclo (throttle). Só opera na conta Chatwoot principal.
import type { DbClient } from "./supabase.ts";
import { accountForChannel } from "./accounts.ts";
import { type CwAcct, envAcct, updateContactProfile } from "./chatwoot.ts";
import { equivalentBrazilianPhoneKeys } from "./phone-keys.ts";
import {
  chooseWhatsAppName,
  trustedWhatsAppName,
  uniqueEligibleWhatsAppInbox,
  uniqueSafeAudienceName,
  verifiedWhatsAppContact,
} from "./whatsapp-name-source.ts";
import { instPost, tokenForInstance, uazapiConfigured } from "./uazapi.ts";

type Json = Record<string, unknown>;
type Channel = Json & {
  id: string;
  chatwoot_inbox_id: number;
  external_id: string;
};
const BATCH = 5;
let page = 1;
let offset = 0;
let scanTick = 0;
let audienceCache:
  | { until: number; rows: { phone: unknown; name: unknown }[] }
  | null = null;

/** A conta do canal é a conta Chatwoot principal do EvoHub? (mesma accountId + mesmo host.) */
function contaPrincipal(acct: CwAcct): boolean {
  const main = envAcct();
  try {
    return String(acct.accountId) === String(main.accountId) &&
      new URL(acct.url).hostname === new URL(main.url).hostname;
  } catch {
    return false;
  }
}

async function audienceRows(
  db: DbClient,
): Promise<{ phone: unknown; name: unknown }[]> {
  if (audienceCache && audienceCache.until > Date.now()) {
    return audienceCache.rows;
  }
  const rows: { phone: unknown; name: unknown }[] = [];
  // A consulta é limitada. Se o banco tiver mais de 20 mil registros, não usar um
  // subconjunto como prova de unicidade: nesse caso só o nome do WhatsApp/telefone vale.
  for (let start = 0; start <= 20_000; start += 1000) {
    const result = await db.from("audience_contacts").select("phone,name")
      .order("audience_id", { ascending: true }).order("phone", {
        ascending: true,
      })
      .range(start, start + 999);
    if (result.error || !Array.isArray(result.data)) return [];
    if (start === 20_000 && result.data.length) return [];
    rows.push(...result.data);
    if (result.data.length < 1000) break;
  }
  audienceCache = { until: Date.now() + 5 * 60_000, rows };
  return rows;
}

async function profileFromInstance(
  channel: Channel,
  phone: string,
): Promise<string | null> {
  if (!uazapiConfigured() || !channel.external_id) return null;
  const token = await tokenForInstance(channel.external_id);
  if (!token) return null;
  const result = await instPost("/chat/details", token, {
    number: phone.replace(/\D/g, ""),
  });
  if (!result.ok) return null;
  const details = (result.data ?? {}) as Json;
  return trustedWhatsAppName(details.wa_name) ??
    trustedWhatsAppName(details.verifiedName);
}

async function syncContact(
  db: DbClient,
  channel: Channel,
  contactId: number,
  phone: string,
): Promise<"updated" | "preserved" | "unresolved"> {
  const acct = await accountForChannel(channel.id);
  if (!contaPrincipal(acct)) return "unresolved";
  const url = `${
    acct.url.replace(/\/+$/, "")
  }/api/v1/accounts/${acct.accountId}/contacts/${contactId}?include_contact_inboxes=true`;
  const response = await fetch(url, {
    headers: { api_access_token: acct.adminToken ?? acct.token },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return "unresolved";
  const body = await response.json();
  const verified = (body?.payload ?? body) as Json;
  if (
    !verifiedWhatsAppContact(
      verified,
      contactId,
      phone,
      Number(channel.chatwoot_inbox_id),
    )
  ) {
    return "unresolved";
  }
  const keys = equivalentBrazilianPhoneKeys(phone);
  const csv = uniqueSafeAudienceName(phone, await audienceRows(db));
  const profile = trustedWhatsAppName(verified.name)
    ? null
    : await profileFromInstance(channel, phone).catch(() => null);
  const choice = chooseWhatsAppName(verified.name, profile, csv, phone);
  if (!choice) return "unresolved";
  if (String(verified.name ?? "").trim() === choice.name) return "preserved";

  const savedName = await updateContactProfile(contactId, {
    name: choice.source === "phone" ? undefined : choice.name,
    fallbackPhone: choice.source === "phone" ? choice.name : undefined,
  }, acct);
  if (savedName !== choice.name) return "unresolved";

  // Vínculo local é opcional no canal nativo. Nunca criar ficha paralela.
  const local = await db.from("contacts").select(
    "id,phone,external_contact_id,customer_id,attributes",
  ).eq("channel_id", channel.id).eq("chatwoot_contact_id", contactId).limit(2);
  if (local.error) throw local.error;
  if (
    local.data?.length === 1 && equivalentBrazilianPhoneKeys(
      local.data[0].phone || local.data[0].external_contact_id,
    ).some((key) => keys.includes(key))
  ) {
    const row = local.data[0] as Json;
    const attrs = (row.attributes as Json | null) ?? {};
    const human = choice.source === "phone" ? null : choice.name;
    const update = await db.from("contacts").update({
      name: human,
      attributes: {
        ...attrs,
        whatsapp_name_checked_at: new Date().toISOString(),
        whatsapp_name_source: choice.source,
        chatwoot_profile_name: choice.name,
      },
    }).eq("id", row.id);
    if (update.error) throw update.error;
    if (row.customer_id && human) {
      const customer = await db.from("customers").update({
        display_name: human,
      })
        .eq("id", row.customer_id);
      if (customer.error) throw customer.error;
    }
  }
  return "updated";
}

export async function repairWhatsAppIncomingWebhook(
  db: DbClient,
  payload: Json,
): Promise<void> {
  const inboxId = Number((payload.inbox as Json | undefined)?.id);
  const sender = (payload.sender as Json | undefined) ?? {};
  const contactId = Number(sender.id);
  if (
    !Number.isSafeInteger(inboxId) || !Number.isSafeInteger(contactId) ||
    !equivalentBrazilianPhoneKeys(sender.phone_number).length
  ) return;
  const result = await db.from("channels").select(
    "id,type,status,external_id,chatwoot_inbox_id",
  ).eq("chatwoot_inbox_id", inboxId).eq("type", "whatsapp").eq(
    "status",
    "active",
  )
    .limit(2);
  if (result.error || result.data?.length !== 1) return;
  await syncContact(
    db,
    result.data[0] as Channel,
    contactId,
    String(sender.phone_number),
  );
}

const recentLocalAttempts = new Map<string, number>();

async function repairRecentLocalContact(
  db: DbClient,
  channels: Channel[],
): Promise<"updated" | "page"> {
  const ids = channels.map((channel) => channel.id);
  if (!ids.length) return "page";
  const result = await db.from("contacts").select(
    "id,channel_id,chatwoot_contact_id,phone,external_contact_id,attributes",
  ).in("channel_id", ids).order("last_seen_at", { ascending: false }).limit(
    100,
  );
  if (result.error) throw result.error;
  const byChannel = new Map(channels.map((channel) => [channel.id, channel]));
  const now = Date.now();
  if (recentLocalAttempts.size > 2000) {
    for (const [id, until] of recentLocalAttempts) {
      if (until <= now) recentLocalAttempts.delete(id);
    }
  }
  for (const row of (result.data ?? []) as Json[]) {
    const id = String(row.id ?? "");
    const contactId = Number(row.chatwoot_contact_id);
    const channel = byChannel.get(String(row.channel_id ?? ""));
    const phone = String(row.phone || row.external_contact_id || "");
    if (
      !id || !channel || !Number.isSafeInteger(contactId) || contactId <= 0 ||
      !equivalentBrazilianPhoneKeys(phone).length
    ) continue;
    const attrs = (row.attributes as Json | null) ?? {};
    const checked = Date.parse(String(attrs.whatsapp_name_checked_at ?? ""));
    if (Number.isFinite(checked) && checked > now - 24 * 60 * 60_000) continue;
    if ((recentLocalAttempts.get(id) ?? 0) > now) continue;
    // A fila local traz os contatos recém-criados da campanha, inclusive quando
    // ainda não receberam mensagem do cliente. Um candidato por ciclo evita rajadas.
    recentLocalAttempts.set(id, now + 5 * 60_000);
    try {
      const outcome = await syncContact(db, channel, contactId, phone);
      if (outcome !== "unresolved") {
        recentLocalAttempts.set(id, now + 24 * 60 * 60_000);
      } else {
        console.warn("whatsapp-name-sync: contato sem vinculo exato", {
          inbox_id: channel.chatwoot_inbox_id,
          contact_id: contactId,
        });
      }
      return outcome === "updated" ? "updated" : "page";
    } catch (error) {
      console.warn("whatsapp-name-sync: contato local nao atualizado", {
        inbox_id: channel.chatwoot_inbox_id,
        contact_id: contactId,
        error: error instanceof Error ? error.name : "unknown",
      });
      return "page";
    }
  }
  return "page";
}

export async function repairWhatsAppNamesStep(db: DbClient): Promise<string> {
  const channelsResult = await db.from("channels").select(
    "id,type,status,external_id,chatwoot_inbox_id",
  ).eq("type", "whatsapp").eq("status", "active");
  if (channelsResult.error) throw channelsResult.error;
  const channelCandidates = (channelsResult.data ?? []) as Channel[];
  const accounts = await Promise.all(channelCandidates.map(async (channel) => {
    try {
      const acct = await accountForChannel(channel.id);
      if (!contaPrincipal(acct)) return null;
      return { channel, acct };
    } catch {
      // Uma instância nova sem credenciais válidas não pode parar as outras.
      console.warn("whatsapp-name-sync: canal sem conta válida", {
        inbox_id: channel.chatwoot_inbox_id,
      });
      return null;
    }
  }));
  const validAccounts = accounts.filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
  const inboxCounts = new Map<number, number>();
  for (const { channel } of validAccounts) {
    const inboxId = Number(channel.chatwoot_inbox_id);
    inboxCounts.set(inboxId, (inboxCounts.get(inboxId) ?? 0) + 1);
  }
  const channels = validAccounts.map(({ channel }) => channel).filter(
    (channel) => {
      const inboxId = Number(channel.chatwoot_inbox_id);
      return Number.isSafeInteger(inboxId) && inboxId > 0 &&
        inboxCounts.get(inboxId) === 1;
    },
  );
  if (!channels.length) return "idle";
  if (await repairRecentLocalContact(db, channels) === "updated") {
    return "updated";
  }
  const acct =
    validAccounts.find(({ channel }) => channel.id === channels[0].id)!.acct;
  const listUrl = new URL(
    `${acct.url.replace(/\/+$/, "")}/api/v1/accounts/${acct.accountId}/contacts`,
  );
  const hotPage = ++scanTick % 6 === 0;
  listUrl.searchParams.set("page", String(hotPage ? 1 : page));
  listUrl.searchParams.set("include_contact_inboxes", "true");
  const response = await fetch(listUrl, {
    headers: { api_access_token: acct.adminToken ?? acct.token },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return "unresolved";
  const body = await response.json();
  const contacts = body?.payload;
  if (!Array.isArray(contacts) || !contacts.length) {
    page = 1;
    offset = 0;
    return "idle";
  }
  const candidates = contacts.slice(
    hotPage ? 0 : offset,
    (hotPage ? 0 : offset) + BATCH,
  ) as Json[];
  if (!hotPage) {
    offset += candidates.length;
    if (offset >= contacts.length) {
      page++;
      offset = 0;
    }
  }
  let updated = 0;
  for (const candidate of candidates) {
    const contactId = Number(candidate.id);
    if (
      !Number.isSafeInteger(contactId) || contactId <= 0 ||
      trustedWhatsAppName(candidate.name)
    ) continue;
    let detail = candidate;
    if (!Array.isArray(detail.contact_inboxes) || !detail.phone_number) {
      const detailResponse = await fetch(
        `${
          acct.url.replace(/\/+$/, "")
        }/api/v1/accounts/${acct.accountId}/contacts/${contactId}?include_contact_inboxes=true`,
        {
          headers: { api_access_token: acct.adminToken ?? acct.token },
          signal: AbortSignal.timeout(8000),
        },
      );
      if (!detailResponse.ok) continue;
      const detailBody = await detailResponse.json();
      detail = (detailBody?.payload ?? detailBody) as Json;
    }
    const phone = String(detail.phone_number ?? "");
    if (!equivalentBrazilianPhoneKeys(phone).length) continue;
    const inboxes = detail.contact_inboxes;
    const inboxId = uniqueEligibleWhatsAppInbox(
      inboxes,
      channels.map((channel) => Number(channel.chatwoot_inbox_id)),
    );
    if (inboxId === null) continue;
    const matched = channels.filter((channel) =>
      Number(channel.chatwoot_inbox_id) === inboxId
    );
    if (matched.length !== 1) continue;
    try {
      if (await syncContact(db, matched[0], contactId, phone) === "updated") {
        updated++;
      }
    } catch (error) {
      console.warn("whatsapp-name-sync: contato nao atualizado", {
        inbox_id: inboxId,
        contact_id: contactId,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }
  return updated ? "updated" : "page";
}
