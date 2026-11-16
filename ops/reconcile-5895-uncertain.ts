// Reconcile only confirmed UAZAPI receipts for uncertain funnel pieces.
// Run without --apply first. No WhatsApp send is performed by this script.
import { admin, claimDelivery } from "../bridge/shared/supabase.ts";
import { instPost, listInstances } from "../bridge/shared/uazapi.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Json = Record<string, unknown>;
type Row = {
  id: string;
  conversation_id: string;
  funnel: string;
  step: number;
  day: number;
  type: string;
  status: string;
  payload: Json;
};

const apply = Deno.args.includes("--apply");
const db = admin();
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const confirmedStatuses = new Set(["Delivered", "Read", "Played"]);
const fail = (message: string): never => { throw new Error(message); };

const { data: failed, error: failedError } = await db.from("scheduled_messages")
  .select("id,conversation_id,funnel,step,day,type,status,payload")
  .like("funnel", `${RESTORED_5895_FUNNEL}%`).eq("status", "failed").limit(1000);
if (failedError) throw failedError;
const rows = ((failed ?? []) as Row[]).filter((row) =>
  (row.payload?.__funnel_delivery as Json | undefined)?.last_outcome ===
    "uncertain"
);
if (!rows.length) {
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", count: 0 }));
  Deno.exit(0);
}

const ids = [...new Set(rows.map((row) => row.conversation_id))];
const { data: conversations, error: conversationError } = await db.from(
  "conversations",
).select("id,chatwoot_conversation_id,channel_id,contacts(external_contact_id)")
  .in("id", ids).limit(1000);
if (conversationError) throw conversationError;
const byConversation = new Map<string, Json>(
  ((conversations ?? []) as Json[]).map((conversation) => [
    String(conversation.id),
    conversation,
  ]),
);
if (byConversation.size !== ids.length) fail("conversa ausente na base");

const channelIds = [...new Set(
  [...byConversation.values()].map((conversation) => String(conversation.channel_id)),
)];
if (channelIds.length !== 1) fail("lote contém mais de um canal");
const { data: channel, error: channelError } = await db.from("channels")
  .select("phone_number").eq("id", channelIds[0]).single();
if (channelError) throw channelError;
if (!digits(channel.phone_number).endsWith("5895")) {
  fail("canal do lote não é o WhatsApp 5895");
}
const instance = (await listInstances()).find((item) =>
  digits(item.number) === digits(channel.phone_number)
);
const instanceToken = instance?.token;
if (!instanceToken) throw new Error("instância uazapi 5895 não encontrada");

const proof: Array<{
  row: Row;
  chatwootId: number;
  providerStatus: string;
  providerAt: string;
  providerId: string | null;
}> = [];
for (const row of rows) {
  const conversation = byConversation.get(row.conversation_id)!;
  const recipient = digits(
    (conversation.contacts as Json | null)?.external_contact_id,
  );
  if (!/^55\d{10,11}$/.test(recipient)) {
    fail(`destinatário inválido para ${row.id}`);
  }
  const attemptAt = Date.parse(String(
    (row.payload.__funnel_delivery as Json).last_attempt_at ?? "",
  ));
  if (!Number.isFinite(attemptAt)) fail(`tentativa sem horário: ${row.id}`);
  const messages: Json[] = [];
  for (let offset = 0; offset <= 800; offset += 200) {
    const provider = await instPost("/message/find", instanceToken, {
      chatid: `${recipient}@s.whatsapp.net`,
      limit: 200,
      offset,
    });
    if (!provider.ok) fail(`consulta uazapi HTTP ${provider.status}`);
    const page = Array.isArray((provider.data as Json).messages)
      ? (provider.data as Json).messages as Json[]
      : [];
    messages.push(...page);
    if (page.length < 200) break;
  }
  const matches = messages.filter((message) => {
    const timestamp = Number(message.messageTimestamp);
    const sendPayload = (message.sendPayload ?? {}) as Json;
    const sameContent = row.type === "video" || row.type === "document"
      ? String(message.messageType).toLowerCase().includes(row.type) &&
        sendPayload.file === row.payload.media_url
      : row.type === "interactive" &&
        sendPayload.text === row.payload.text;
    return message.fromMe === true && sameContent &&
      confirmedStatuses.has(String(message.status)) &&
      timestamp >= attemptAt - 30_000 && timestamp <= attemptAt + 180_000;
  });
  if (matches.length !== 1) {
    fail(`recibo não é único para ${row.id}: ${matches.length}`);
  }
  const match = matches[0];
  proof.push({
    row,
    chatwootId: Number(conversation.chatwoot_conversation_id),
    providerStatus: String(match.status),
    providerAt: new Date(Number(match.messageTimestamp)).toISOString(),
    providerId: match.id == null ? null : String(match.id),
  });
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  confirmed: proof.length,
  statuses: proof.reduce((acc: Record<string, number>, item) => {
    acc[item.providerStatus] = (acc[item.providerStatus] ?? 0) + 1;
    return acc;
  }, {}),
  chatwootConversations: proof.map((item) => item.chatwootId).sort((a, b) => a - b),
}));
if (!apply) Deno.exit(0);

for (const item of proof) {
  const { row } = item;
  const delivery = row.payload.__funnel_delivery as Json;
  const { data: current, error: currentError } = await db.from(
    "scheduled_messages",
  ).select("status,payload").eq("id", row.id).single();
  if (currentError) throw currentError;
  if (
    current.status !== "failed" ||
    (current.payload as Json)?.__funnel_delivery == null ||
    ((current.payload as Json).__funnel_delivery as Json).attempt_id !==
      delivery.attempt_id
  ) {
    fail(`estado mudou durante reconciliação: ${row.id}`);
  }
  const { data: updated, error: updateError } = await db.from(
    "scheduled_messages",
  ).update({
    status: "sent",
    sent_at: item.providerAt,
    payload: {
      ...row.payload,
      __funnel_delivery: {
        ...delivery,
        last_outcome: "sent",
        reconciled_from: "uazapi_message_history",
        provider_status: item.providerStatus,
        provider_id: item.providerId,
        provider_copies: 1,
      },
    },
  }).eq("id", row.id).eq("status", "failed").select("id");
  if (updateError) throw updateError;
  if (updated?.length !== 1) fail(`estado mudou durante atualização: ${row.id}`);
  await claimDelivery(db, `funnel-sent-${row.id}`, "funnel-delivery-success");
  const { error: eventError } = await db.from("events").insert({
    source: "funil",
    event_type: "provider_delivery_reconciled",
    payload: {
      conversation_id: row.conversation_id,
      chatwoot_conversation_id: item.chatwootId,
      scheduled_message_id: row.id,
      step: row.step,
      provider_status: item.providerStatus,
      provider_id: item.providerId,
      provider_copies: 1,
      sent_at: item.providerAt,
    },
  });
  if (eventError) throw eventError;
}
console.log(JSON.stringify({ applied: proof.length, resent: 0 }));
