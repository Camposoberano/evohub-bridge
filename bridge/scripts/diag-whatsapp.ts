// Diagnóstico canal WhatsApp: status, token, eventos hub/chatwoot recentes, mensagens recentes.
// Rodar (dentro de bridge/):
//   deno run --allow-net --allow-env --env-file=.env scripts/diag-whatsapp.ts
import { admin } from "../shared/supabase.ts";

const db = admin();

const { data: channels, error: chErr } = await db.from("channels")
  .select("id,name,status,phone_number_id,waba_id,phone_number,chatwoot_inbox_id,chatwoot_inbox_identifier,connected_at,last_error")
  .eq("type", "whatsapp");
if (chErr) throw chErr;
console.log("channels:", JSON.stringify(channels, null, 2));

for (const ch of channels ?? []) {
  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", ch.id).maybeSingle();
  console.log(`canal ${ch.id} token:`, secret?.channel_token ? `presente (len=${secret.channel_token.length})` : "AUSENTE");

  const { data: messages } = await db.from("messages")
    .select("created_at,direction,msg_type,content,media_url,status,meta_message_id")
    .eq("channel_id", ch.id)
    .order("created_at", { ascending: false })
    .limit(10);
  console.log(`canal ${ch.id} mensagens recentes:`, JSON.stringify(messages, null, 2));
}

console.log("agora:", new Date().toISOString());

const { data: hubEvents, error: hubErr } = await db.from("events")
  .select("received_at,event_type,payload")
  .eq("source", "hub")
  .order("received_at", { ascending: false })
  .limit(10);
if (hubErr) console.log("hub events erro:", JSON.stringify(hubErr));
console.log("hub events recentes:", JSON.stringify((hubEvents ?? []).map((e) => ({
  received_at: e.received_at,
  event_type: e.event_type,
  object: (e.payload as Record<string, unknown>)?.object,
  changes: ((e.payload as Record<string, unknown>)?.entry as Record<string, unknown>[] | undefined)?.[0]?.changes,
})), null, 2));

const { data: cwEvents, error: cwErr } = await db.from("events")
  .select("received_at,event_type,payload")
  .eq("source", "chatwoot")
  .order("received_at", { ascending: false })
  .limit(10);
if (cwErr) console.log("chatwoot events erro:", JSON.stringify(cwErr));
console.log("chatwoot events recentes:", JSON.stringify((cwEvents ?? []).map((e) => {
  const p = e.payload as Record<string, unknown>;
  return {
    received_at: e.received_at,
    event_type: e.event_type,
    message_type: p?.message_type,
    inbox: (p?.inbox as Record<string, unknown>)?.id,
    content: p?.content,
    attachments: Array.isArray(p?.attachments) ? (p.attachments as unknown[]).length : 0,
  };
}), null, 2));
