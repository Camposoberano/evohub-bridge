import type { DbClient } from "./supabase.ts";
import { MEGA_SORGO_7D_VERSION, SEVEN_DAY_CONTENT } from "./mega-sorgo-7d-content.ts";
import { scheduleSevenDayTestPieces } from "./mega-sorgo-7d-schedule.ts";

export type SevenDayInboundDecision = "click" | "pause" | "optout";

function passiveSevenDayClick(id: string): boolean {
  return /^(?:f[1-4]_(?:sim|olhando|continuar|leite|corte|ambos|milho|capim|nao|ja|nunca)|f5_(?:pensar|depois)|video_7d_(?:sim|nao))$/.test(id);
}

const passiveButtonTitles = new Set(SEVEN_DAY_CONTENT.flatMap((piece) => {
  const buttons = Array.isArray(piece.payload.buttons) ? piece.payload.buttons : [];
  const sections = Array.isArray(piece.payload.sections) ? piece.payload.sections : [];
  const rows = sections.flatMap((section: unknown) => {
    const candidate = section as { rows?: unknown[] };
    return Array.isArray(candidate.rows) ? candidate.rows : [];
  });
  return [...buttons, ...rows]
    .filter((item): item is { id: string; title: string } =>
      !!item && typeof item === "object" &&
      passiveSevenDayClick(String((item as { id?: unknown }).id ?? "")) &&
      typeof (item as { title?: unknown }).title === "string")
    .map((item) => item.title.trim());
}));

export function rebaseSevenDayPaused(
  rows: { id: string; day: number; step: number }[], now = Date.now(),
): { id: string; send_at: string }[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.day - b.day || a.step - b.step);
  const scheduled = scheduleSevenDayTestPieces(sorted.map((row) => ({
    code: row.id, day: row.day,
  })), now + 5 * 60_000);
  return scheduled.map((piece) => ({ id: piece.code, send_at: piece.sendAt }));
}

export async function resumeSevenDaySequence(db: DbClient, conversationId: string): Promise<number> {
  const { data: sequence, error: sequenceError } = await db.from("sales_sequences")
    .select("id,status").eq("conversation_id", conversationId)
    .eq("funnel", MEGA_SORGO_7D_VERSION).maybeSingle();
  if (sequenceError) throw sequenceError;
  if (sequence?.status !== "paused") return 0;
  const { data: paused, error: pausedError } = await db.from("scheduled_messages")
    .select("id,day,step").eq("conversation_id", conversationId)
    .like("funnel", `${MEGA_SORGO_7D_VERSION}%`).eq("status", "paused")
    .order("day").order("step").limit(100);
  if (pausedError) throw pausedError;
  const rebased = rebaseSevenDayPaused((paused ?? []) as { id: string; day: number; step: number }[]);
  for (const row of rebased) {
    const { error } = await db.from("scheduled_messages").update({
      status: "pending", send_at: row.send_at,
    }).eq("id", row.id).eq("status", "paused");
    if (error) throw error;
  }
  const { error: stateError } = await db.from("sales_sequences")
    .update({ status: "running" }).eq("id", sequence.id).eq("status", "paused");
  if (stateError) throw stateError;
  return rebased.length;
}

export async function transitionSevenDaySequence(
  db: DbClient,
  conversationId: string,
  status: "paused" | "cancelled",
  reason: string,
): Promise<boolean> {
  const { data: sequence, error: sequenceError } = await db.from("sales_sequences")
    .select("id,status").eq("conversation_id", conversationId)
    .eq("funnel", MEGA_SORGO_7D_VERSION).maybeSingle();
  if (sequenceError) throw sequenceError;
  if (!sequence || !["running", "paused"].includes(String(sequence.status))) return false;
  const { error: queueError } = await db.from("scheduled_messages")
    .update({ status })
    .eq("conversation_id", conversationId)
    .like("funnel", `${MEGA_SORGO_7D_VERSION}%`)
    .in("status", status === "cancelled" ? ["pending", "paused"] : ["pending"]);
  if (queueError) throw queueError;
  const { error: stateError } = await db.from("sales_sequences")
    .update({ status }).eq("id", sequence.id).in("status", ["running", "paused"]);
  if (stateError) throw stateError;
  const { error: eventError } = await db.from("events").insert({
    source: "mega-sorgo-7d",
    event_type: status === "cancelled" ? "closed" : "paused",
    payload: { conversation_id: conversationId, reason },
  });
  if (eventError) throw eventError;
  return true;
}

export function classifySevenDayInbound(input: {
  content: string;
  clickId?: string | null;
}): SevenDayInboundDecision {
  // Só cliques informativos seguem a cadência. Preço, reserva, material e
  // atendimento desviam para outra ação: congelar a cadência evita sobreposição.
  if (input.clickId) {
    if (passiveSevenDayClick(input.clickId)) {
      return "click";
    }
    return "pause";
  }
  // Alguns provedores espelham o clique em dois eventos sem ID: primeiro
  // "[button]", depois o título exato. Nenhum dos dois é texto livre.
  if (input.content.trim() === "[button]" || passiveButtonTitles.has(input.content.trim())) {
    return "click";
  }
  if (/\b(n[aã]o quero|sem interesse|me tira|pare|para de mandar|sai|stop)\b/i
    .test(input.content)) return "optout";
  return "pause";
}

/** Move both sequence and queue to a terminal or paused state for this conversation only. */
export async function applySevenDayInboundState(
  db: DbClient,
  conversationId: string,
  input: { content: string; clickId?: string | null },
): Promise<SevenDayInboundDecision | null> {
  const decision = classifySevenDayInbound(input);
  if (decision === "click") return decision;
  const changed = await transitionSevenDaySequence(db, conversationId,
    decision === "optout" ? "cancelled" : "paused",
    decision === "optout" ? "optout" : "resposta_cliente");
  return changed ? decision : null;
}
