import { admin, claimDelivery } from "../bridge/shared/supabase.ts";
import { instPost, listInstances } from "../bridge/shared/uazapi.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Json = Record<string, unknown>;
const APPLY = Deno.args.includes("--apply");
const db = admin();
const { data: conversation, error: conversationError } = await db.from(
  "conversations",
).select("id,channel_id,contacts(external_contact_id)")
  .eq("chatwoot_conversation_id", 3402).single();
if (conversationError) throw conversationError;
const { data: channel, error: channelError } = await db.from("channels")
  .select("phone_number").eq("id", conversation.channel_id).single();
if (channelError) throw channelError;
const { data: row, error: rowError } = await db.from("scheduled_messages")
  .select("id,status,send_at,sent_at,payload")
  .eq("conversation_id", conversation.id).eq("funnel", RESTORED_5895_FUNNEL)
  .eq("step", 5).single();
if (rowError) throw rowError;
const payload = (row.payload ?? {}) as Json;
const mediaUrl = String(payload.media_url ?? "");
if (!mediaUrl) throw new Error("vídeo da etapa sem URL");

const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const instance = (await listInstances()).find((item) =>
  digits(item.number) === digits(channel.phone_number)
);
if (!instance?.token) throw new Error("instância 5895 não encontrada");
const recipient = digits(
  (conversation.contacts as Json | null)?.external_contact_id,
);
if (!/^55\d{10,11}$/.test(recipient)) {
  throw new Error("destinatário não corresponde a telefone brasileiro");
}
const provider = await instPost("/message/find", instance.token, {
  chatid: `${recipient}@s.whatsapp.net`,
  limit: 100,
  offset: 0,
});
if (!provider.ok) {
  throw new Error(`Uazapi /message/find HTTP ${provider.status}`);
}
const providerMessages = Array.isArray((provider.data as Json).messages)
  ? (provider.data as Json).messages as Json[]
  : [];
const scheduledAt = Date.parse(String(row.send_at));
const matches = providerMessages.filter((message) => {
  const at = Number(message.messageTimestamp);
  const outboundVideo = message.fromMe === true &&
    String(message.messageType).toLowerCase().includes("video");
  const sameFile = (message.sendPayload as Json | undefined)?.file === mediaUrl;
  const delivered = ["Delivered", "Read", "Played"].includes(
    String(message.status),
  );
  return outboundVideo && sameFile && delivered &&
    at >= scheduledAt && at < scheduledAt + 10 * 60_000;
});
if (!matches.length) {
  throw new Error("nenhuma entrega confirmada no provedor; sem reconciliação");
}
const firstAt = Math.min(
  ...matches.map((message) => Number(message.messageTimestamp)),
);
console.log(JSON.stringify(
  {
    mode: APPLY ? "apply" : "dry-run",
    chatwoot: 3402,
    scheduled_status: row.status,
    provider_delivered_copies: matches.length,
    first_delivered_at: new Date(firstAt).toISOString(),
  },
  null,
  2,
));
if (!APPLY) Deno.exit(0);

if (row.status !== "failed" && row.status !== "sent") {
  throw new Error(`estado ${row.status} não permite reconciliação`);
}
if (row.status === "failed") {
  const delivery = (payload.__funnel_delivery ?? {}) as Json;
  const { data: updated, error: updateError } = await db.from(
    "scheduled_messages",
  ).update({
    status: "sent",
    sent_at: new Date(firstAt).toISOString(),
    payload: {
      ...payload,
      __funnel_delivery: {
        ...delivery,
        last_outcome: "sent",
        reconciled_from: "uazapi_message_history",
        provider_status: "Delivered",
        provider_copies: matches.length,
      },
    },
  }).eq("id", row.id).eq("status", "failed").select("id");
  if (updateError) throw updateError;
  if (updated?.length !== 1) throw new Error("a etapa mudou durante a revisão");
}
await claimDelivery(db, `funnel-sent-${row.id}`, "funnel-delivery-success");
if (row.status === "failed") {
  const { error: eventError } = await db.from("events").insert({
    source: "funil",
    event_type: "funnel_delivery_reconciled",
    channel_id: conversation.channel_id,
    payload: {
      conversation_id: conversation.id,
      chatwoot_conversation_id: 3402,
      scheduled_message_id: row.id,
      funnel: RESTORED_5895_FUNNEL,
      provider: "uazapi",
      provider_status: "Delivered",
      delivered_copies: matches.length,
      first_delivered_at: new Date(firstAt).toISOString(),
      retry_performed: false,
    },
  });
  if (eventError) throw eventError;
}
console.log(JSON.stringify({ reconciled: true, resent: false }));
