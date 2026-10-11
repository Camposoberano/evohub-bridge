import type { DbClient } from "./supabase.ts";
import { RESTORED_5895_FUNNEL, SOCIAL_N8N_FUNNEL } from "./funnel-identity.ts";
import { addBusinessSeconds, clampBusinessTime } from "./business-time.ts";
import { windowState } from "./window.ts";

type Json = Record<string, unknown>;

export const WINDOW_HOLD_FLAG = "__awaiting_meta_window";
export const WINDOW_CLOSED_REASON = "window_closed";

export function isN8nManagedFunnel(funnel: unknown): boolean {
  const value = String(funnel ?? "");
  return value === RESTORED_5895_FUNNEL ||
    value.startsWith(`${RESTORED_5895_FUNNEL}:`) ||
    value === SOCIAL_N8N_FUNNEL || value.startsWith(`${SOCIAL_N8N_FUNNEL}:`);
}

export function rebaseWindowHeldRows(
  rows: Array<{ id: string; send_at: string }>,
  now = Date.now(),
): Array<{ id: string; send_at: string }> {
  const sorted = [...rows].sort((a, b) =>
    Date.parse(a.send_at) - Date.parse(b.send_at)
  );
  if (!sorted.length) return [];
  const firstOriginal = Date.parse(sorted[0].send_at);
  if (!Number.isFinite(firstOriginal) || sorted.some((row) =>
    !Number.isFinite(Date.parse(row.send_at)))) {
    throw new Error("agenda pausada inválida");
  }
  const firstNew = clampBusinessTime(now + 15_000);
  return sorted.map((row) => ({
    id: row.id,
    send_at: new Date(addBusinessSeconds(
      firstNew,
      Math.max(0, Math.ceil((Date.parse(row.send_at) - firstOriginal) / 1000)),
    )).toISOString(),
  }));
}

/** Pausa todas as peças sociais ainda pendentes; uma falha parcial fica em failed. */
export async function holdSocialWindowMessages(
  db: DbClient,
  conversationId: string,
): Promise<number> {
  const { data, error } = await db.from("scheduled_messages")
    .select("id,payload")
    .eq("conversation_id", conversationId).eq("status", "pending")
    .like("funnel", `${SOCIAL_N8N_FUNNEL}%`).limit(500);
  if (error) throw error;
  let held = 0;
  for (const row of (data ?? []) as Json[]) {
    const payload = row.payload && typeof row.payload === "object"
      ? row.payload as Json
      : {};
    const { error: updateError } = await db.from("scheduled_messages")
      .update({
        status: "paused",
        payload: {
          ...payload,
          [WINDOW_HOLD_FLAG]: true,
          __pause_reason: WINDOW_CLOSED_REASON,
        },
      }).eq("id", row.id).eq("status", "pending");
    if (updateError) throw updateError;
    held++;
  }
  if (held) {
    await db.from("events").insert({
      source: "funil",
      event_type: "social_window_closed",
      payload: { conversation_id: conversationId, held_messages: held,
        reason: WINDOW_CLOSED_REASON },
    });
  }
  return held;
}

/** Reabre somente peças pausadas por janela, com janela realmente aberta. */
export async function resumeWindowHeldMessages(
  db: DbClient,
  conversationId: string,
  now = Date.now(),
): Promise<number> {
  const { data: conv, error: convError } = await db.from("conversations")
    .select("id,channel_id,origem").eq("id", conversationId).maybeSingle();
  if (convError) throw convError;
  if (!conv) return 0;
  const { data: channel, error: channelError } = await db.from("channels")
    .select("id,type,phone_number_id")
    .eq("id", conv.channel_id).maybeSingle();
  if (channelError) throw channelError;
  if (!channel || !(await windowState(db, conv, channel)).aberta) return 0;

  const { data, error } = await db.from("scheduled_messages")
    .select("id,payload,send_at")
    .eq("conversation_id", conversationId)
    .eq("status", "paused")
    .limit(500);
  if (error) throw error;
  const held = ((data ?? []) as Json[]).filter((row) => {
    const payload = row.payload as Json | null;
    return payload?.[WINDOW_HOLD_FLAG] === true;
  });
  const rebased = rebaseWindowHeldRows(held.map((row) => ({
    id: String(row.id), send_at: String(row.send_at),
  })), now);
  for (const row of rebased) {
    const original = held.find((item) => item.id === row.id)!;
    const payload = { ...original.payload as Json };
    delete payload[WINDOW_HOLD_FLAG];
    delete payload.__pause_reason;
    const { error: updateError } = await db.from("scheduled_messages").update({
      status: "pending",
      send_at: row.send_at,
      payload,
    }).eq("id", row.id).eq("status", "paused");
    if (updateError) throw updateError;
  }
  if (rebased.length) {
    await db.from("events").insert({
      source: "funil",
      event_type: "window_held_resumed",
      payload: { conversation_id: conversationId,
        resumed_messages: rebased.length },
    });
  }
  return rebased.length;
}
