import { admin } from "../bridge/shared/supabase.ts";
import { iniciosDosAcessos } from "../bridge/handlers/funil-enroll.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Json = Record<string, unknown>;
const APPLY = Deno.args.includes("--apply");
const CHANNEL_ID = "cf316d59-f6da-4683-adcc-29095a805dde";
const db = admin();
const { data: conversation, error: conversationError } = await db.from(
  "conversations",
).select("id,channel_id,origem,status,outcome,bot_muted_at")
  .eq("chatwoot_conversation_id", 3511).single();
if (conversationError) throw conversationError;
if (
  conversation.channel_id !== CHANNEL_ID ||
  conversation.origem !== "anuncio" ||
  conversation.status !== "open" ||
  String(conversation.outcome ?? "open") !== "open" ||
  conversation.bot_muted_at
) throw new Error("#3511 não está elegível para retomada");

const { data: sequence, error: sequenceError } = await db.from(
  "sales_sequences",
).select("id,status").eq("conversation_id", conversation.id)
  .eq("funnel", RESTORED_5895_FUNNEL).single();
if (sequenceError) throw sequenceError;
const { data: rows, error: rowsError } = await db.from("scheduled_messages")
  .select("id,day,step,status,send_at,sent_at,type")
  .eq("conversation_id", conversation.id)
  .eq("funnel", RESTORED_5895_FUNNEL).order("step").limit(100);
if (rowsError) throw rowsError;
if (
  sequence.status !== "paused" || rows?.length !== 31 ||
  rows.some((row: Json) => row.status !== "paused" || row.sent_at !== null)
) throw new Error("fila alterada ou já enviada; sem recuperação automática");
const firstByDay = new Map<number, number>();
for (const row of rows as Json[]) {
  const day = Number(row.day);
  const at = Date.parse(String(row.send_at));
  if (!Number.isInteger(day) || day < 1 || day > 5 || !Number.isFinite(at)) {
    throw new Error("agenda original inválida");
  }
  firstByDay.set(day, Math.min(firstByDay.get(day) ?? at, at));
}
if (firstByDay.size !== 5) throw new Error("fases incompletas");

// Os cinco acessos seguem os mesmos intervalos de produção: imediato, +30 min,
// +6 h, +12 h, +12 h dentro da janela de 06h a 22h de Fortaleza.
const starts = iniciosDosAcessos(
  Date.now(),
  [0, 1_800, 21_600, 43_200, 43_200],
  false,
);
const changes = (rows as Json[]).map((row) => {
  const day = Number(row.day);
  const offset = Date.parse(String(row.send_at)) - firstByDay.get(day)!;
  if (offset < 0 || offset > 560_000) {
    throw new Error(`offset inválido na peça ${row.step}`);
  }
  return {
    id: String(row.id),
    step: Number(row.step),
    send_at: new Date(starts[day - 1] + offset).toISOString(),
  };
});
console.log(JSON.stringify({
  mode: APPLY ? "apply" : "dry-run",
  chatwoot: 3511,
  pieces: changes.length,
  first_at: changes[0].send_at,
  last_at: changes.at(-1)?.send_at,
  old_first_at: rows[0].send_at,
}, null, 2));
if (!APPLY) Deno.exit(0);

// Enquanto as linhas estão pausadas, atualiza os horários sem risco de o cron
// consumir uma agenda parcialmente regravada.
for (const change of changes) {
  const { data: updated, error } = await db.from("scheduled_messages")
    .update({ send_at: change.send_at }).eq("id", change.id)
    .eq("status", "paused").is("sent_at", null).select("id");
  if (error) throw error;
  if (updated?.length !== 1) {
    throw new Error(`peça ${change.step} mudou durante a recuperação`);
  }
}
const { data: running, error: runningError } = await db.from(
  "sales_sequences",
).update({ status: "running" }).eq("id", sequence.id).eq("status", "paused")
  .select("id");
if (runningError) throw runningError;
if (running?.length !== 1) throw new Error("sequência mudou antes da retomada");
const { data: pending, error: pendingError } = await db.from(
  "scheduled_messages",
).update({ status: "pending" }).eq("conversation_id", conversation.id)
  .eq("funnel", RESTORED_5895_FUNNEL).eq("status", "paused")
  .select("id");
if (pendingError) throw pendingError;
if (pending?.length !== 31) {
  throw new Error(`somente ${pending?.length ?? 0} peças foram retomadas`);
}
const { error: eventError } = await db.from("events").insert({
  source: "funil",
  event_type: "logistics_pause_corrected",
  channel_id: CHANNEL_ID,
  payload: {
    conversation_id: conversation.id,
    chatwoot_conversation_id: 3511,
    funnel: RESTORED_5895_FUNNEL,
    pieces_rebased: 31,
    first_at: changes[0].send_at,
    whatsapp_resend_performed: false,
  },
});
if (eventError) throw eventError;
console.log(JSON.stringify({ resumed: true, pieces: 31, resent: false }));
