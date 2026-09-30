// Revalida cada contato da fila imediatamente antes do primeiro envio da campanha.
// A fila trabalha um destinatário por vez, então só consultamos o contato que já chegou
// à vez dele — nunca a lista inteira de uma vez.
import type { DbClient } from "./supabase.ts";
import { deriveOutcome } from "./outcome-labels.ts";
import { getDirectUazapiRoute, type HybridRoute } from "./hybrid.ts";
import { instGet, instPost } from "./uazapi.ts";

type Json = Record<string, unknown>;

const TRINTA_DIAS_MS = 30 * 24 * 60 * 60_000;
const BLOCKLIST_CACHE_MS = 60_000;

type BlocklistCache = { checkedAt: number; numbers: Set<string> };
const blocklistCache = new Map<string, BlocklistCache>();

export class CampaignPreflightUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignPreflightUnavailable";
  }
}

export type CampaignPreflightResult =
  | { eligible: true }
  | { eligible: false; reason: string };

function digits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function rowsFrom(data: unknown): Json[] {
  if (Array.isArray(data)) return data as Json[];
  if (!data || typeof data !== "object") return [];
  const root = data as Json;
  for (const key of ["data", "result", "results", "contacts", "numbers"]) {
    if (Array.isArray(root[key])) return root[key] as Json[];
  }
  return [];
}

async function whatsappChannels(db: DbClient): Promise<string[]> {
  const { data, error } = await db.from("channels").select("id").eq(
    "type",
    "whatsapp",
  );
  if (error) throw error;
  return (data ?? []).map((row: Json) => String(row.id)).filter(Boolean);
}

async function currentBlocklist(
  route: HybridRoute,
  now: number,
): Promise<Set<string>> {
  const cached = blocklistCache.get(route.instance);
  if (cached && now - cached.checkedAt < BLOCKLIST_CACHE_MS) {
    return cached.numbers;
  }

  const response = await instGet("/chat/blocklist", route.token);
  if (!response.ok) {
    throw new CampaignPreflightUnavailable(
      `verificador de bloqueio indisponível (${response.status})`,
    );
  }
  const numbers = new Set(
    (JSON.stringify(response.data ?? {}).match(/\d{12,}/g) ?? []).map(digits),
  );
  blocklistCache.set(route.instance, { checkedAt: now, numbers });
  return numbers;
}

async function findContacts(
  db: DbClient,
  phone: string,
  channelIds: string[],
): Promise<Json[]> {
  if (!channelIds.length) return [];
  const { data: customer, error: customerError } = await db.from("customers")
    .select("id")
    .eq("identity_key", `phone:${phone}`)
    .maybeSingle();
  if (customerError) throw customerError;

  if (customer?.id) {
    const { data, error } = await db.from("contacts")
      .select("id,channel_id,external_contact_id,phone,attributes")
      .eq("customer_id", customer.id)
      .in("channel_id", channelIds);
    if (error) throw error;
    if (data?.length) return data as Json[];
  }

  // Compatibilidade com contatos importados antes da identidade global ser preenchida.
  const variants = [phone, `+${phone}`];
  const [byExternalId, byPhone] = await Promise.all([
    db.from("contacts").select(
      "id,channel_id,external_contact_id,phone,attributes",
    )
      .in("channel_id", channelIds).in("external_contact_id", variants),
    db.from("contacts").select(
      "id,channel_id,external_contact_id,phone,attributes",
    )
      .in("channel_id", channelIds).in("phone", variants),
  ]);
  if (byExternalId.error) throw byExternalId.error;
  if (byPhone.error) throw byPhone.error;
  const unique = new Map<string, Json>();
  for (const row of [...(byExternalId.data ?? []), ...(byPhone.data ?? [])]) {
    unique.set(String(row.id), row as Json);
  }
  return [...unique.values()];
}

/**
 * Só autoriza envio se os dados internos e o WhatsApp ainda confirmarem que o contato pode
 * receber. Erros de consulta são transitórios: o chamador pausa a campanha inteira em vez
 * de enviar sem validação ou descartar o contato.
 */
export async function validarContatoAntesDaCampanha(input: {
  db: DbClient;
  channelId: string;
  channelName: string;
  phone: string;
  route: HybridRoute | null;
  now?: number;
}): Promise<CampaignPreflightResult> {
  const { db } = input;
  const phone = digits(input.phone);
  const now = input.now ?? Date.now();

  if (!/^55\d{10,11}$/.test(phone)) {
    return {
      eligible: false,
      reason: "número fora do padrão WhatsApp do Brasil",
    };
  }

  let route = input.route;
  if (!route) {
    try {
      route = await getDirectUazapiRoute(input.channelId, input.channelName);
    } catch (error) {
      throw new CampaignPreflightUnavailable(
        `não foi possível localizar o verificador WhatsApp: ${String(error)}`,
      );
    }
  }
  if (!route) {
    throw new CampaignPreflightUnavailable(
      `instância ${
        input.channelName || input.channelId
      } sem verificador WhatsApp conectado`,
    );
  }

  const channelIds = await whatsappChannels(db);
  const contacts = await findContacts(db, phone, channelIds);
  const attributes = contacts.map((contact) =>
    (contact.attributes ?? {}) as Json
  );
  if (
    attributes.some((attrs) =>
      attrs.blocked === true || attrs.automation_excluded === true ||
      attrs.dead === true
    )
  ) {
    return {
      eligible: false,
      reason: "contato bloqueado ou excluído no cadastro",
    };
  }

  const contactIds = [
    ...new Set(contacts.map((contact) => String(contact.id))),
  ];
  const conversations: Json[] = [];
  if (contactIds.length) {
    for (let offset = 0; offset < contactIds.length; offset += 100) {
      const batch = contactIds.slice(offset, offset + 100);
      const { data, error } = await db.from("conversations")
        .select("id,status,outcome,labels")
        .in("contact_id", batch)
        .in("channel_id", channelIds);
      if (error) throw error;
      conversations.push(...(data ?? []) as Json[]);
    }
  }

  if (
    conversations.some((conversation) => {
      const labels = Array.isArray(conversation.labels)
        ? conversation.labels.map((label) => String(label))
        : [];
      return conversation.outcome === "won" ||
        conversation.outcome === "lost" ||
        deriveOutcome(labels) !== null;
    })
  ) {
    return {
      eligible: false,
      reason: "contato já comprado ou classificado como não comprador",
    };
  }

  if (
    conversations.some((conversation) => conversation.status !== "resolved")
  ) {
    return {
      eligible: false,
      reason: "há atendimento ativo em um número da empresa",
    };
  }

  const conversationIds = conversations.map((conversation) =>
    String(conversation.id)
  );
  if (conversationIds.length) {
    const [recentInbound, orders, quotes] = await Promise.all([
      db.from("messages").select("id").in("conversation_id", conversationIds)
        .eq("direction", "in")
        .gte("sent_at", new Date(now - TRINTA_DIAS_MS).toISOString())
        .limit(1),
      db.from("orders").select("id,stage")
        .in("conversation_id", conversationIds),
      db.from("quotes").select("id,stage")
        .in("conversation_id", conversationIds),
    ]);
    if (recentInbound.error) throw recentInbound.error;
    if (orders.error) throw orders.error;
    if (quotes.error) throw quotes.error;
    if (recentInbound.data?.length) {
      return {
        eligible: false,
        reason:
          "cliente enviou mensagem a um número da empresa nos últimos 30 dias",
      };
    }
    if (
      (orders.data ?? []).some((order: Json) => order.stage !== "cancelado")
    ) {
      return {
        eligible: false,
        reason: "há pedido ou atendimento de compra em andamento",
      };
    }
    if (
      (quotes.data ?? []).some((quote: Json) => quote.stage !== "cancelado")
    ) {
      return {
        eligible: false,
        reason: "há orçamento ou atendimento de compra em andamento",
      };
    }
  }

  try {
    if ((await currentBlocklist(route, now)).has(phone)) {
      return {
        eligible: false,
        reason: "número está na lista de bloqueio do WhatsApp",
      };
    }

    const response = await instPost("/chat/check", route.token, {
      numbers: [phone],
    });
    if (!response.ok) {
      throw new CampaignPreflightUnavailable(
        `verificador WhatsApp indisponível (${response.status})`,
      );
    }
    const checked = rowsFrom(response.data);
    const match = checked.find((row) =>
      digits(row.query ?? row.number) === phone
    ) ??
      (checked.length === 1 ? checked[0] : undefined);
    if (typeof match?.isInWhatsapp !== "boolean") {
      throw new CampaignPreflightUnavailable(
        "verificador WhatsApp não confirmou o resultado deste número",
      );
    }
    if (!match.isInWhatsapp) {
      await db.from("clientes").update({
        on_whatsapp: false,
        enrich_status: "no_wa",
        updated_at: new Date(now).toISOString(),
      }).eq("phone", phone);
      return { eligible: false, reason: "número não está mais no WhatsApp" };
    }
  } catch (error) {
    if (error instanceof CampaignPreflightUnavailable) throw error;
    throw new CampaignPreflightUnavailable(
      `falha na revalidação antes do envio: ${String(error)}`,
    );
  }

  return { eligible: true };
}
