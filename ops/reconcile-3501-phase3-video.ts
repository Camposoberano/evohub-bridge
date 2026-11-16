import { admin, claimDelivery } from "../bridge/shared/supabase.ts";
import { instPost, listInstances } from "../bridge/shared/uazapi.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Json = Record<string, unknown>;
const apply = Deno.args.includes("--apply");
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const db = admin();
const { data: conversation, error: conversationError } = await db.from(
  "conversations",
).select("id,channel_id,contacts(external_contact_id)")
  .eq("chatwoot_conversation_id", 3501).single();
if (conversationError) throw conversationError;
const { data: channel, error: channelError } = await db.from("channels")
  .select("phone_number").eq("id", conversation.channel_id).single();
if (channelError) throw channelError;
const { data: row, error: rowError } = await db.from("scheduled_messages")
  .select("id,status,send_at,payload")
  .eq("conversation_id", conversation.id).eq("funnel", RESTORED_5895_FUNNEL)
  .eq("step", 15).single();
if (rowError) throw rowError;
const payload = (row.payload ?? {}) as Json;
const mediaUrl = String(payload.media_url ?? "");
if (!mediaUrl || row.status !== "failed") {
  throw new Error("vídeo da fase 3 não está em falha reconciliável");
}
const instance = (await listInstances()).find((item) =>
  digits(item.number) === digits(channel.phone_number)
);
if (!instance?.token) throw new Error("instância 5895 não encontrada");
const recipient = digits(
  (conversation.contacts as Json | null)?.external_contact_id,
);
if (!/^55\d{10,11}$/.test(recipient)) {
  throw new Error("destinatário não corresponde ao WhatsApp 5895");
}
const provider = await instPost("/message/find", instance.token, {
  chatid: `${recipient}@s.whatsapp.net`,
  limit: 200,
  offset: 0,
});
if (!provider.ok) throw new Error(`provedor HTTP ${provider.status}`);
const messages = Array.isArray((provider.data as Json).messages)
  ? (provider.data as Json).messages as Json[]
  : [];
const dueAt = Date.parse(String(row.send_at));
const matches = messages.filter((message) =>
  message.fromMe === true &&
  String(message.messageType).toLowerCase().includes("video") &&
  (message.sendPayload as Json | undefined)?.file === mediaUrl &&
  ["Delivered", "Read", "Played"].includes(String(message.status)) &&
  Number(message.messageTimestamp) >= dueAt - 30_000 &&
  Number(message.messageTimestamp) < dueAt + 10 * 60_000
);
if (matches.length !== 1) {
  throw new Error(`esperada uma cópia confirmada do vídeo; encontradas ${matches.length}`);
}
const sentAt = new Date(Number(matches[0].messageTimestamp)).toISOString();
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", chatwoot: 3501,
  step: 15, provider_copies: matches.length, provider_status: matches[0].status,
  sent_at: sentAt }));
if (!apply) Deno.exit(0);
const delivery = (payload.__funnel_delivery ?? {}) as Json;
const { data: updated, error: updateError } = await db.from("scheduled_messages")
  .update({
    status: "sent",
    sent_at: sentAt,
    payload: { ...payload, __funnel_delivery: {
      ...delivery, last_outcome: "sent", reconciled_from: "uazapi_message_history",
      provider_status: String(matches[0].status), provider_copies: 1,
    } },
  }).eq("id", row.id).eq("status", "failed").select("id");
if (updateError) throw updateError;
if (updated?.length !== 1) throw new Error("etapa alterada durante reconciliação");
await claimDelivery(db, `funnel-sent-${row.id}`, "funnel-delivery-success");
const { error: eventError } = await db.from("events").insert({
  source: "funil", event_type: "provider_video_reconciled",
  payload: { conversation_id: conversation.id, chatwoot_conversation_id: 3501,
    scheduled_message_id: row.id, step: 15, provider_status: matches[0].status,
    provider_copies: 1, sent_at: sentAt },
});
if (eventError) throw eventError;
