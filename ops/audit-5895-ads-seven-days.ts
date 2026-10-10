import { admin } from "../bridge/shared/supabase.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Row = Record<string, unknown>;
const db = admin();
const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
const { data: channels, error: channelError } = await db.from("channels")
  .select("id,name,phone_number").limit(200);
if (channelError) throw channelError;
const channel = (channels as Row[]).find((row) =>
  String(row.phone_number ?? "").replace(/\D/g, "").endsWith("5895")
);
if (!channel) throw new Error("canal 5895 ausente");
const { data: conversations, error: conversationError } = await db.from(
  "conversations",
).select("id,chatwoot_conversation_id,opened_at,origem,referral,status,outcome")
  .eq("channel_id", channel.id).gte("opened_at", cutoff)
  .order("opened_at", { ascending: true }).limit(1000);
if (conversationError) throw conversationError;
const ads = ((conversations ?? []) as Row[]).filter((row) =>
  row.referral != null || row.origem === "anuncio"
);
const sequences: Row[] = [];
const openings: Row[] = [];
const scheduled: Row[] = [];
const inbound: Row[] = [];
const outbound: Row[] = [];
for (let start = 0; start < ads.length; start += 20) {
  const ids = ads.slice(start, start + 20).map((row) => String(row.id));
  const [seq, first, allScheduled, incoming, outgoing] = await Promise.all([
    db.from("sales_sequences").select("conversation_id,funnel,status,updated_at")
      .in("conversation_id", ids).limit(1000),
    db.from("scheduled_messages")
      .select("conversation_id,funnel,step,status,send_at,sent_at")
      .in("conversation_id", ids).eq("step", 0).limit(1000),
    db.from("scheduled_messages")
      .select("conversation_id,funnel,step,status")
      .in("conversation_id", ids).limit(1000),
    db.from("messages").select("conversation_id,sent_at")
      .in("conversation_id", ids).eq("direction", "in")
      .order("sent_at", { ascending: true }).limit(1000),
    db.from("messages").select("conversation_id,sent_at,funnel,scheduled_message_id")
      .in("conversation_id", ids).eq("direction", "out")
      .order("sent_at", { ascending: true }).limit(1000),
  ]);
  for (const result of [seq, first, allScheduled, incoming, outgoing]) {
    if (result.error) throw result.error;
  }
  sequences.push(...(seq.data ?? []) as Row[]);
  openings.push(...(first.data ?? []) as Row[]);
  scheduled.push(...(allScheduled.data ?? []) as Row[]);
  inbound.push(...(incoming.data ?? []) as Row[]);
  outbound.push(...(outgoing.data ?? []) as Row[]);
}
function firstByConversation(rows: Row[]): Map<string, Row> {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const key = String(row.conversation_id);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}
const firstInbound = firstByConversation(inbound);
const firstOutbound = firstByConversation(outbound);
const sequenceByConversation = new Map<string, Row[]>();
for (const row of sequences) {
  const key = String(row.conversation_id);
  sequenceByConversation.set(key, [...(sequenceByConversation.get(key) ?? []), row]);
}
const openingByConversation = new Map<string, Row[]>();
for (const row of openings) {
  const key = String(row.conversation_id);
  openingByConversation.set(key, [...(openingByConversation.get(key) ?? []), row]);
}
const scheduledByConversation = new Map<string, Row[]>();
for (const row of scheduled) {
  const key = String(row.conversation_id);
  scheduledByConversation.set(key, [...(scheduledByConversation.get(key) ?? []), row]);
}
const result = ads.map((conversation) => {
  const id = String(conversation.id);
  const first = firstInbound.get(id);
  const firstReply = firstOutbound.get(id);
  const originAt = Date.parse(String(first?.sent_at ?? conversation.opened_at));
  const seq = (sequenceByConversation.get(id) ?? []).find((item) =>
    item.funnel === RESTORED_5895_FUNNEL
  );
  const opening = (openingByConversation.get(id) ?? []).find((item) =>
    item.funnel === RESTORED_5895_FUNNEL
  );
  const sentAt = Date.parse(String(opening?.sent_at ?? ""));
  const firstReplyAt = Date.parse(String(firstReply?.sent_at ?? ""));
  const steps = scheduledByConversation.get(id) ?? [];
  return {
    chatwoot: conversation.chatwoot_conversation_id,
    opened_at: conversation.opened_at,
    inbound_at: first?.sent_at ?? null,
    referral: conversation.referral != null,
    status: conversation.status,
    outcome: conversation.outcome,
    funnel: seq ? "restored" : (sequenceByConversation.get(id) ?? []).map((item) => item.funnel),
    sequence_status: seq?.status ?? null,
    opening_status: opening?.status ?? null,
    scheduled_count: steps.length,
    sent_count: steps.filter((row) => row.status === "sent").length,
    failed_steps: steps.filter((row) => row.status === "failed")
      .map((row) => `${row.funnel}:${row.step}`),
    opening_delay_s: Number.isFinite(sentAt) ? Math.round((sentAt - originAt) / 1000) : null,
    first_reply_delay_s: Number.isFinite(firstReplyAt)
      ? Math.round((firstReplyAt - originAt) / 1000)
      : null,
  };
});
console.log(JSON.stringify({ cutoff, channel: "5895", total: result.length, rows: result }));
