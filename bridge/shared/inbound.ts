// Ingestão comum de mensagens recebidas: cria contato/conversa no Chatwoot
// e persiste a mensagem no Supabase com dedupe por meta_message_id.
import type { DbClient } from "./supabase.ts";
import {
  type ChatwootAttachment,
  createConversation,
  createConversationMessage,
  createIncomingMessage,
  ensureContact,
} from "./chatwoot.ts";

type Json = Record<string, unknown>;
type MsgType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "location" | "contact" | "interactive" | "template" | "unknown";

export type InboundAttachment = ChatwootAttachment & {
  sourceUrl?: string;
};

export async function ingestInbound(
  db: DbClient,
  channel: Json,
  msg: {
    from: string;
    name?: string;
    metaMessageId?: string;
    msgType: string;
    content: string;
    sentAt?: string;
    attachments?: InboundAttachment[];
    outgoing?: boolean; // echo: mensagem enviada pelo aparelho (coexistência) -> entra como saída
    skipChatwoot?: boolean; // canal nativo: não posta no Chatwoot (evita duplicata), só persiste no banco
  },
): Promise<{ inserted: boolean; reason?: string; message_id?: string }> {
  const direction = msg.outgoing ? "out" : "in";
  const skip = msg.skipChatwoot === true;
  if (msg.metaMessageId) {
    const { data: existingMessages } = await db.from("messages")
      .select("id")
      .eq("meta_message_id", msg.metaMessageId)
      .limit(1);
    const existingMessage = existingMessages?.[0];
    if (existingMessage?.id) return { inserted: false, reason: "duplicate", message_id: existingMessage.id as string };
  }

  const inboxId = channel.chatwoot_inbox_identifier as string;
  const phone = channel.type === "whatsapp" ? `+${msg.from}` : null;

  const { data: existing, error: contactQueryError } = await db
    .from("contacts").select("*")
    .eq("channel_id", channel.id).eq("external_contact_id", msg.from).maybeSingle();
  if (contactQueryError) throw contactQueryError;

  let contact = existing as Json | null;
  let sourceId = (existing?.attributes as Json | undefined)?.source_id as string | undefined;

  if (!contact || (!sourceId && !skip)) {
    // nativo: não cria contato no Chatwoot (a nativa já tem o seu) — só no banco.
    const cw = skip ? null : await ensureContact(inboxId, { name: msg.name, phone: phone ?? undefined, identifier: msg.from });
    if (cw) sourceId = cw.source_id;
    const { data: upserted, error: upsertError } = await db.from("contacts").upsert({
      channel_id: channel.id,
      external_contact_id: msg.from,
      name: msg.name ?? null,
      phone: phone,
      chatwoot_contact_id: cw?.contact_id ?? (contact?.chatwoot_contact_id ?? null),
      attributes: sourceId ? { source_id: sourceId } : ((contact?.attributes as Json) ?? {}),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "channel_id,external_contact_id" }).select().single();
    if (upsertError) throw upsertError;
    contact = upserted as Json;
  } else {
    const { error: updateError } = await db.from("contacts")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", contact.id);
    if (updateError) throw updateError;
  }

  const { data: openConv, error: convQueryError } = await db
    .from("conversations").select("*")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).maybeSingle();
  if (convQueryError) throw convQueryError;

  let conv = openConv as Json | null;
  if (!conv) {
    // nativo: conversa só no banco (a nativa gerencia a dela).
    const cwConv = skip ? null : await createConversation(inboxId, sourceId!);
    const { data: insertedConv, error: convInsertError } = await db.from("conversations").insert({
      channel_id: channel.id,
      contact_id: contact.id,
      chatwoot_conversation_id: cwConv?.id ?? null,
      status: "open",
    }).select().single();
    if (convInsertError) throw convInsertError;
    conv = insertedConv as Json;
  }

  const attachments = msg.attachments ?? [];
  let cwMsg: (Record<string, unknown> & { id?: number }) | null = null;
  if (skip) {
    // nativo: não posta no Chatwoot. Entrada já chega na caixa nativa pelo repasse do EVO Hub.
    cwMsg = null;
  } else if (msg.outgoing) {
    // echo do aparelho -> mensagem de SAÍDA na conversa do cliente.
    cwMsg = await createConversationMessage(conv.chatwoot_conversation_id as number, {
      content: msg.content,
      messageType: "outgoing",
      attachments,
    });
  } else if (attachments.length > 0) {
    cwMsg = await createConversationMessage(conv.chatwoot_conversation_id as number, {
      content: msg.content,
      messageType: "incoming",
      attachments,
    });
  } else {
    cwMsg = await createIncomingMessage(inboxId, sourceId!, conv.chatwoot_conversation_id as number, msg.content);
  }
  const chatwootMediaUrl = cwMsg ? firstAttachmentUrl(cwMsg) : (msg.attachments?.[0]?.sourceUrl ?? null);
  const { data: insertedMessage, error: messageError } = await db.from("messages").insert({
    conversation_id: conv.id,
    channel_id: channel.id,
    direction,
    msg_type: normalizeMsgType(msg.msgType),
    content: msg.content,
    media_url: chatwootMediaUrl,
    meta_message_id: msg.metaMessageId ?? null,
    chatwoot_message_id: cwMsg?.id ?? null,
    status: msg.outgoing ? "sent" : "received",
    sent_at: msg.sentAt ?? new Date().toISOString(),
  }).select("id").single();

  if (messageError) {
    if ((messageError as { code?: string }).code === "23505") return { inserted: false, reason: "duplicate" };
    throw messageError;
  }

  return { inserted: true, message_id: insertedMessage.id as string };
}

export async function repairInboundMedia(
  db: DbClient,
  messageId: string,
  input: {
    msgType: string;
    content: string;
    attachments: InboundAttachment[];
  },
): Promise<{ repaired: boolean; reason?: string }> {
  if (input.attachments.length === 0) return { repaired: false, reason: "sem anexos" };

  const { data: message, error: messageError } = await db.from("messages")
    .select("id,conversation_id,media_url,chatwoot_message_id")
    .eq("id", messageId)
    .single();
  if (messageError) throw messageError;
  if (message?.media_url) return { repaired: false, reason: "ja reparado" };

  const { data: conversation, error: convError } = await db.from("conversations")
    .select("chatwoot_conversation_id")
    .eq("id", message.conversation_id)
    .single();
  if (convError) throw convError;

  const cwConversationId = conversation?.chatwoot_conversation_id as number | undefined;
  if (!cwConversationId) return { repaired: false, reason: "sem conversa Chatwoot" };

  const cwMsg = await createConversationMessage(cwConversationId, {
    content: input.content,
    messageType: "incoming",
    attachments: input.attachments,
  });
  const chatwootMediaUrl = firstAttachmentUrl(cwMsg) ?? input.attachments[0]?.sourceUrl ?? null;

  const { error: updateError } = await db.from("messages").update({
    msg_type: normalizeMsgType(input.msgType),
    content: input.content,
    media_url: chatwootMediaUrl,
    chatwoot_message_id: cwMsg?.id ?? message.chatwoot_message_id ?? null,
    status: "received",
  }).eq("id", messageId);
  if (updateError) throw updateError;

  return { repaired: true };
}

function normalizeMsgType(value: string): MsgType {
  if (
    value === "text" || value === "image" || value === "audio" || value === "video" ||
    value === "document" || value === "sticker" || value === "location" || value === "contact" ||
    value === "interactive" || value === "template"
  ) return value;
  return "unknown";
}

function firstAttachmentUrl(message: Record<string, unknown>): string | null {
  const attachments = message.attachments as Json[] | undefined;
  const first = Array.isArray(attachments) ? attachments[0] : undefined;
  const attachment = first ?? (message.attachment as Json | undefined);
  if (!attachment) return null;

  const dataUrl = attachment.data_url as string | undefined;
  const thumbUrl = attachment.thumb_url as string | undefined;
  return dataUrl ?? thumbUrl ?? null;
}
