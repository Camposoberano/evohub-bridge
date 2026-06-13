// Ingestão comum de mensagens recebidas: cria contato/conversa no Chatwoot
// e persiste a mensagem no Supabase com dedupe por meta_message_id.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createConversation, createIncomingMessage, ensureContact } from "./chatwoot.ts";

type Json = Record<string, unknown>;

export async function ingestInbound(
  db: SupabaseClient,
  channel: Json,
  msg: {
    from: string;
    name?: string;
    metaMessageId?: string;
    msgType: string;
    content: string;
    sentAt?: string;
  },
): Promise<{ inserted: boolean; reason?: string; message_id?: string }> {
  if (msg.metaMessageId) {
    const { data: existingMessage } = await db.from("messages")
      .select("id")
      .eq("meta_message_id", msg.metaMessageId)
      .maybeSingle();
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

  if (!contact || !sourceId) {
    const cw = await ensureContact(inboxId, { name: msg.name, phone: phone ?? undefined, identifier: msg.from });
    sourceId = cw.source_id;
    const { data: upserted, error: upsertError } = await db.from("contacts").upsert({
      channel_id: channel.id,
      external_contact_id: msg.from,
      name: msg.name ?? null,
      phone: phone,
      chatwoot_contact_id: cw.contact_id ?? null,
      attributes: { source_id: sourceId },
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
    const cwConv = await createConversation(inboxId, sourceId!);
    const { data: insertedConv, error: convInsertError } = await db.from("conversations").insert({
      channel_id: channel.id,
      contact_id: contact.id,
      chatwoot_conversation_id: cwConv.id,
      status: "open",
    }).select().single();
    if (convInsertError) throw convInsertError;
    conv = insertedConv as Json;
  }

  const cwMsg = await createIncomingMessage(inboxId, sourceId!, conv.chatwoot_conversation_id as number, msg.content);
  const { data: insertedMessage, error: messageError } = await db.from("messages").insert({
    conversation_id: conv.id,
    channel_id: channel.id,
    direction: "in",
    msg_type: msg.msgType === "text" ? "text" : "unknown",
    content: msg.content,
    meta_message_id: msg.metaMessageId ?? null,
    chatwoot_message_id: cwMsg?.id ?? null,
    status: "received",
    sent_at: msg.sentAt ?? new Date().toISOString(),
  }).select("id").single();

  if (messageError) {
    if ((messageError as { code?: string }).code === "23505") return { inserted: false, reason: "duplicate" };
    throw messageError;
  }

  return { inserted: true, message_id: insertedMessage.id as string };
}
