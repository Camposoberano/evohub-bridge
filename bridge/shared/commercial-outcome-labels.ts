// Etiqueta visível é consequência do bloqueio durável, nunca sua única proteção.
import type { DbClient } from "./supabase.ts";
import { getConversationLabels, setConversationLabels } from "./chatwoot.ts";
import { accountForChannel } from "./accounts.ts";
import { instGet, instPost, listInstances } from "./uazapi.ts";
import { canonize, deriveOutcome } from "./outcome-labels.ts";

type Json = Record<string, unknown>;
const CHATWOOT_LABEL = "nao-compra";
const WHATSAPP_LABEL = "Não COMPRA";

export type LabelPorts = {
  getChatwoot: () => Promise<string[]>;
  setChatwoot: (labels: string[]) => Promise<void>;
  getWhatsapp: () => Promise<Array<{ id: string; name: string }>>;
  hasWhatsapp?: (id: string) => Promise<boolean>;
  addWhatsapp: (id: string) => Promise<void>;
};

export async function applyNoPurchaseLabels(ports: LabelPorts): Promise<{
  chatwoot: boolean;
  whatsapp: boolean;
  errors: string[];
}> {
  let chatwoot = false;
  let whatsapp = false;
  const errors: string[] = [];
  try {
    const labels = await ports.getChatwoot();
    if (!labels.some((label) => canonize(label) === "nao compra")) {
      await ports.setChatwoot([...labels, CHATWOOT_LABEL]);
    }
    chatwoot = true;
  } catch (error) {
    errors.push(
      `chatwoot: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const labels = await ports.getWhatsapp();
    const target = labels.find((label) =>
      canonize(label.name) === "nao compra"
    );
    if (!target) throw new Error("etiqueta Não COMPRA não encontrada");
    if (!ports.hasWhatsapp || !await ports.hasWhatsapp(target.id)) {
      await ports.addWhatsapp(target.id);
    }
    whatsapp = true;
  } catch (error) {
    errors.push(
      `whatsapp: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return { chatwoot, whatsapp, errors };
}

export async function ensureNoPurchaseLabels(
  db: DbClient,
  channelId: string,
  externalContactId: string,
): Promise<{ chatwoot: boolean; whatsapp: boolean; errors: string[] }> {
  const { data: contact, error: contactError } = await db.from("contacts")
    .select("id,attributes").eq("channel_id", channelId)
    .eq("external_contact_id", externalContactId).maybeSingle();
  if (contactError) throw contactError;
  if (!contact) {
    throw new Error("contato não encontrado para aplicar etiquetas");
  }
  const { data: conversation, error: conversationError } = await db.from(
    "conversations",
  )
    .select("chatwoot_conversation_id").eq("contact_id", contact.id)
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (conversationError) throw conversationError;
  const cwId = Number(conversation?.chatwoot_conversation_id);
  if (!cwId) throw new Error("conversa sem id do Chatwoot");
  const { data: channel, error: channelError } = await db.from("channels")
    .select("name,type").eq("id", channelId).maybeSingle();
  if (channelError) throw channelError;
  const account = await accountForChannel(channelId);
  const isWhatsapp = channel?.type === "whatsapp";
  const instances = isWhatsapp ? await listInstances() : [];
  const instance = instances.find((item) => item.name === channel.name);
  if (isWhatsapp && !instance) {
    throw new Error("instância WhatsApp não encontrada");
  }
  const phone = externalContactId.replace(/\D/g, "");
  const result = await applyNoPurchaseLabels({
    getChatwoot: () => getConversationLabels(cwId, account),
    setChatwoot: (labels) => setConversationLabels(cwId, labels, account),
    getWhatsapp: async () => {
      if (!isWhatsapp) return [{ id: "not-applicable", name: WHATSAPP_LABEL }];
      if (!instance) throw new Error("instância WhatsApp não encontrada");
      const response = await instGet("/labels", instance.token);
      if (!response.ok) throw new Error(`GET /labels ${response.status}`);
      const body = response.data as Json | Json[];
      const rows = (Array.isArray(body) ? body : (body.labels ?? [])) as Json[];
      return rows.map((row) => ({
        id: String(row.id ?? row.labelId ?? ""),
        name: String(row.name ?? row.title ?? ""),
      }));
    },
    hasWhatsapp: async (id) => {
      if (!isWhatsapp) return true;
      if (!instance) throw new Error("instância WhatsApp não encontrada");
      const response = await instPost("/chat/details", instance.token, {
        number: phone,
      });
      if (!response.ok) {
        throw new Error(`POST /chat/details ${response.status}`);
      }
      const body = response.data as Json;
      const ids = Array.isArray(body.wa_label) ? body.wa_label : [];
      return ids.some((current) => String(current) === id);
    },
    addWhatsapp: async (id) => {
      if (!isWhatsapp) return;
      if (!instance) throw new Error("instância WhatsApp não encontrada");
      const response = await instPost("/chat/labels", instance.token, {
        number: phone,
        labelIds: [id],
        action: "add",
      });
      if (!response.ok) throw new Error(`POST /chat/labels ${response.status}`);
    },
  });
  if (!isWhatsapp) result.whatsapp = false;
  const attributes = (contact.attributes ?? {}) as Json;
  if (result.chatwoot && (!isWhatsapp || result.whatsapp)) {
    const { error } = await db.from("contacts").update({
      attributes: {
        ...attributes,
        no_purchase_labels_confirmed_at: new Date().toISOString(),
      },
    }).eq("id", contact.id);
    if (error) throw error;
  }
  if (result.errors.length) {
    const { error } = await db.from("events").insert({
      source: "funil",
      event_type: "commercial_no_purchase_label_sync_failed",
      channel_id: channelId,
      payload: { contact_id: contact.id, errors: result.errors },
    });
    if (error) throw error;
  }
  return result;
}

/** Remoção de ambas as etiquetas reabilita novos atendimentos, sem reabrir filas antigas. */
export async function reconcileNoPurchaseRemoval(
  db: DbClient,
  contactId: string,
  conversationId: string,
  labels: string[],
  liveLabelsAbsent = false,
): Promise<boolean> {
  if (!liveLabelsAbsent) return false;
  const { data: otherConversations, error: otherError } = await db.from(
    "conversations",
  )
    .select("labels").eq("contact_id", contactId).neq("id", conversationId);
  if (otherError) throw otherError;
  const { data: contact, error: contactError } = await db.from("contacts")
    .select("attributes").eq("id", contactId).maybeSingle();
  if (contactError) throw contactError;
  const attrs = (contact?.attributes ?? {}) as Json;
  const otherLabels = (otherConversations ?? []).map((row: Json) =>
    Array.isArray(row.labels) ? row.labels.map(String) : []
  );
  if (!shouldReleaseNoPurchaseBlock(attrs, labels, otherLabels)) return false;
  const next = { ...attrs };
  delete next.blocked;
  delete next.blocked_reason;
  delete next.blocked_at;
  delete next.no_purchase_labels_confirmed_at;
  const { error: unblockError } = await db.from("contacts").update({
    attributes: next,
  })
    .eq("id", contactId);
  if (unblockError) throw unblockError;
  const { error: outcomeError } = await db.from("conversations").update({
    outcome: "open",
    outcome_source: "label-removed",
    outcome_set_at: new Date().toISOString(),
  }).eq("contact_id", contactId).eq("outcome", "lost")
    .in("outcome_source", [
      "explicit-reply",
      "whatsapp-label",
      "chatwoot-label",
      "manual",
    ]);
  if (outcomeError) throw outcomeError;
  return true;
}

/** Confirma a retirada nas duas interfaces antes de liberar um bloqueio durável. */
export async function confirmNoPurchaseLabelsAbsent(
  db: DbClient,
  contactId: string,
): Promise<boolean> {
  const { data: contact, error: contactError } = await db.from("contacts")
    .select("channel_id,external_contact_id").eq("id", contactId).maybeSingle();
  if (contactError) throw contactError;
  if (!contact) return false;
  const { data: conversation, error: conversationError } = await db.from(
    "conversations",
  )
    .select("chatwoot_conversation_id").eq("contact_id", contactId)
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (conversationError) throw conversationError;
  const cwId = Number(conversation?.chatwoot_conversation_id);
  if (!cwId) return false;
  const account = await accountForChannel(String(contact.channel_id));
  const chatwootLabels = await getConversationLabels(cwId, account);
  if (deriveOutcome(chatwootLabels) === "lost") return false;

  const { data: channel, error: channelError } = await db.from("channels")
    .select("name,type").eq("id", contact.channel_id).maybeSingle();
  if (channelError) throw channelError;
  if (channel?.type !== "whatsapp") return true;
  const instance = (await listInstances()).find((item) =>
    item.name === channel.name
  );
  if (!instance) return false;
  const response = await instPost("/chat/find", instance.token, {});
  if (!response.ok) throw new Error(`POST /chat/find ${response.status}`);
  const body = response.data as Json | Json[];
  const chats = (Array.isArray(body) ? body : body.chats) as Json[] | undefined;
  if (!Array.isArray(chats)) return false;
  const phone = String(contact.external_contact_id).replace(/\D/g, "");
  const chat = chats.find((row) =>
    String(row.wa_chatid ?? "").split("@")[0].replace(/\D/g, "") === phone
  );
  if (!chat || !Array.isArray(chat.wa_label)) return false;
  const catalog = await instGet("/labels", instance.token);
  if (!catalog.ok) throw new Error(`GET /labels ${catalog.status}`);
  const catalogBody = catalog.data as Json | Json[];
  const rows =
    (Array.isArray(catalogBody) ? catalogBody : catalogBody.labels) as
      | Json[]
      | undefined;
  if (!Array.isArray(rows)) return false;
  const noPurchaseIds = new Set(
    rows.filter((row) =>
      canonize(String(row.name ?? row.title ?? "")) === "nao compra"
    ).map((row) => String(row.id ?? row.labelId ?? "")),
  );
  if (noPurchaseIds.size === 0) return false;
  return !chat.wa_label.some((id) => noPurchaseIds.has(String(id)));
}

export function shouldReleaseNoPurchaseBlock(
  attributes: Json,
  currentLabels: string[],
  otherLabels: string[][],
): boolean {
  return attributes.blocked_reason === "nao-compra" &&
    Boolean(attributes.no_purchase_labels_confirmed_at) &&
    deriveOutcome(currentLabels) === null &&
    otherLabels.every((labels) => deriveOutcome(labels) === null);
}
