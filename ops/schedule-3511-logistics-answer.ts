import { admin } from "../bridge/shared/supabase.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Json = Record<string, unknown>;
const APPLY = Deno.args.includes("--apply");
const db = admin();
const { data: conversation, error: conversationError } = await db.from(
  "conversations",
).select("id,channel_id,chatwoot_conversation_id,status,origem")
  .eq("chatwoot_conversation_id", 3511).single();
if (conversationError) throw conversationError;
if (
  conversation.status !== "open" || conversation.origem !== "anuncio" ||
  conversation.channel_id !== "cf316d59-f6da-4683-adcc-29095a805dde"
) throw new Error("#3511 não está elegível para a resposta adiada");
const { data: sequence, error: sequenceError } = await db.from(
  "sales_sequences",
).select("status").eq("conversation_id", conversation.id)
  .eq("funnel", RESTORED_5895_FUNNEL).single();
if (sequenceError) throw sequenceError;
if (sequence.status !== "running") throw new Error("sequência não está ativa");
const [dayResult, deferredResult] = await Promise.all([
  db.from("scheduled_messages").select("step,status,send_at,type")
    .eq("conversation_id", conversation.id)
    .eq("funnel", RESTORED_5895_FUNNEL).eq("day", 1).order("step")
    .limit(20),
  db.from("scheduled_messages").select("id,status,payload")
    .eq("conversation_id", conversation.id)
    .eq("funnel", RESTORED_5895_FUNNEL)
    .eq("type", "deferred_intent").limit(20),
]);
if (dayResult.error) throw dayResult.error;
if (deferredResult.error) throw deferredResult.error;
if (deferredResult.data?.length) {
  throw new Error("já existe rota adiada nesta conversa");
}
const openings = ((dayResult.data ?? []) as Json[]).filter((row) =>
  row.type !== "deferred_intent"
);
if (
  openings.length !== 7 ||
  openings.some((row) => row.status !== "pending")
) throw new Error("primeira fase mudou; revisar antes de agendar resposta");
const latest = Math.max(
  ...openings.map((row) => Date.parse(String(row.send_at))),
);
const sendAt = new Date(latest + 20_000).toISOString();
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  chatwoot: 3511,
  action: "menu_logistica",
  send_at: sendAt,
  opening_pieces: openings.length,
}, null, 2));
if (!APPLY) Deno.exit(0);

const { data: inserted, error: insertError } = await db.from(
  "scheduled_messages",
).insert({
  conversation_id: conversation.id,
  chatwoot_conversation_id: 3511,
  funnel: RESTORED_5895_FUNNEL,
  day: 1,
  step: 31,
  type: "deferred_intent",
  status: "paused",
  payload: {
    __deferred_action: "menu_logistica",
    __source_message_id: null,
  },
  send_at: sendAt,
}).select("id").single();
if (insertError) throw insertError;
const { error: eventError } = await db.from("events").insert({
  source: "funil",
  event_type: "logistics_answer_deferred",
  channel_id: conversation.channel_id,
  payload: {
    conversation_id: conversation.id,
    chatwoot_conversation_id: 3511,
    scheduled_message_id: inserted.id,
    action: "menu_logistica",
    send_at: sendAt,
  },
});
if (eventError) throw eventError;
console.log(JSON.stringify({ scheduled: true, sent_now: false }));
