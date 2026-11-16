import { admin } from "../bridge/shared/supabase.ts";
import { instPost, listInstances } from "../bridge/shared/uazapi.ts";

type Json = Record<string, unknown>;
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const db = admin();
const { data: conversation, error: conversationError } = await db.from(
  "conversations",
).select("channel_id,contacts(external_contact_id)")
  .eq("chatwoot_conversation_id", 3524).single();
if (conversationError) throw conversationError;
const { data: channel, error: channelError } = await db.from("channels")
  .select("phone_number").eq("id", conversation.channel_id).single();
if (channelError) throw channelError;
const instance = (await listInstances()).find((item) =>
  digits(item.number) === digits(channel.phone_number)
);
if (!instance?.token) throw new Error("instância 5895 não encontrada");
const recipient = digits(
  (conversation.contacts as Json | null)?.external_contact_id,
);
const provider = await instPost("/message/find", instance.token, {
  chatid: `${recipient}@s.whatsapp.net`, limit: 100, offset: 0,
});
if (!provider.ok) throw new Error(`provedor HTTP ${provider.status}`);
const messages = Array.isArray((provider.data as Json).messages)
  ? (provider.data as Json).messages as Json[]
  : [];
const start = Date.parse("2026-10-10T17:47:00-03:00");
const end = Date.parse("2026-10-10T18:03:00-03:00");
const outbound = messages.filter((message) => {
  const at = Number(message.messageTimestamp);
  return message.fromMe === true && at >= start && at <= end;
}).map((message) => ({
  type: message.messageType,
  status: message.status,
  at: new Date(Number(message.messageTimestamp)).toISOString(),
})).sort((a, b) => a.at.localeCompare(b.at));
console.log(JSON.stringify({ chatwoot: 3524, provider_outbound: outbound }));
