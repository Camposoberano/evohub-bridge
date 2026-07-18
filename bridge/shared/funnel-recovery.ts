import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

const AUTO_RESUME_AFTER_MS = 90 * 60_000;
const MAX_CONTACT_AGE_MS = 20 * 60 * 60_000;
const MAX_AUTO_RESUME_INBOUND_AGE_MS = 6 * 60 * 60_000;
const FOLLOW_UP_AFTER_MS = 2 * 60 * 60_000;
const FOLLOW_UP_FUNNEL = "mega-sorgo-followup";

export type FunnelMaintenanceResult = {
  scanned: number;
  completed: number;
  resumed: number;
  followups: number;
};

export function rebasePausedSchedule(
  sendAtValues: string[],
  startAt: number,
): string[] {
  if (!sendAtValues.length) return [];
  const parsed = sendAtValues.map((value) => Date.parse(value));
  const first = Math.min(...parsed);
  return parsed.map((value) =>
    new Date(startAt + Math.max(0, value - first)).toISOString()
  );
}

export function canAutoResume(input: {
  now: number;
  pauseAt: number;
  lastActivityAt: number;
  lastInboundAt: number;
  pauseType: string;
  outcome?: string | null;
}): boolean {
  return input.pauseType === "auto_paused" && !input.outcome &&
    input.now - input.pauseAt >= AUTO_RESUME_AFTER_MS &&
    input.now - input.lastActivityAt >= AUTO_RESUME_AFTER_MS &&
    input.now - input.lastInboundAt <= MAX_AUTO_RESUME_INBOUND_AGE_MS;
}

export async function maintainFunnels(
  db: DbClient,
  now = Date.now(),
): Promise<FunnelMaintenanceResult> {
  const result = { scanned: 0, completed: 0, resumed: 0, followups: 0 };
  const { data: sequences, error } = await db.from("sales_sequences")
    .select("id,conversation_id,chatwoot_conversation_id,funnel,status")
    .eq("funnel", "mega-sorgo")
    .in("status", ["running", "paused"])
    .limit(500);
  if (error) throw error;
  if (!sequences?.length) return result;

  const conversationIds = sequences.map((item: Json) => item.conversation_id);
  const since = new Date(now - 48 * 60 * 60_000).toISOString();
  const [{ data: conversations }, { data: pauseEvents }] = await Promise.all([
    db.from("conversations")
      .select("id,channel_id,outcome")
      .in("id", conversationIds),
    db.from("events")
      .select("event_type,received_at,payload")
      .eq("source", "funil")
      .in("event_type", ["auto_paused", "manual_paused"])
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(2_000),
  ]);
  const conversationMap = new Map(
    (conversations ?? []).map((item: Json) => [String(item.id), item]),
  );
  const latestPause = new Map<string, Json>();
  for (const event of (pauseEvents ?? []) as Json[]) {
    const payload = (event.payload as Json | undefined) ?? {};
    const id = String(payload.conversation_id ?? "");
    if (id && !latestPause.has(id)) latestPause.set(id, event);
  }

  for (const sequence of sequences as Json[]) {
    result.scanned++;
    const conversationId = String(sequence.conversation_id);
    const { data: queue, error: queueError } = await db.from(
      "scheduled_messages",
    )
      .select("id,day,status,send_at,sent_at")
      .eq("conversation_id", conversationId)
      .eq("funnel", String(sequence.funnel ?? "mega-sorgo"))
      .order("send_at", { ascending: true })
      .limit(500);
    if (queueError) throw queueError;
    const rows = (queue ?? []) as Json[];
    const sentRows = rows.filter((row) => row.status === "sent");
    const remaining = rows.filter((row) =>
      ["pending", "paused", "failed"].includes(String(row.status))
    );

    if (sentRows.length > 0 && remaining.length === 0) {
      const lastSentAt = latestTimestamp(
        sentRows.map((row) => String(row.sent_at ?? row.send_at)),
      );
      await db.from("sales_sequences").update({
        status: "completed",
        current_day: Math.max(...sentRows.map((row) => Number(row.day ?? 0))),
        last_sent_at: new Date(lastSentAt).toISOString(),
      }).eq("id", sequence.id);
      await db.from("events").insert({
        source: "funil",
        event_type: "funnel_completed",
        payload: {
          conversation_id: conversationId,
          chatwoot_conversation_id: sequence.chatwoot_conversation_id,
          sent_messages: sentRows.length,
          last_sent_at: new Date(lastSentAt).toISOString(),
        },
      });
      result.completed++;
      if (await scheduleSilentFollowup(db, sequence, lastSentAt, now)) {
        result.followups++;
      }
      continue;
    }

    if (sequence.status !== "paused") continue;
    const pausedRows = rows.filter((row) => row.status === "paused");
    if (!pausedRows.length) continue;
    const pause = latestPause.get(conversationId);
    if (!pause) continue;
    const activity = await latestActivity(db, conversationId);
    if (!activity.lastInboundAt || !activity.lastActivityAt) continue;
    const conversation = conversationMap.get(conversationId) as
      | Json
      | undefined;
    if (
      !canAutoResume({
        now,
        pauseAt: Date.parse(String(pause.received_at)),
        lastActivityAt: activity.lastActivityAt,
        lastInboundAt: activity.lastInboundAt,
        pauseType: String(pause.event_type),
        outcome: String(conversation?.outcome ?? "") || null,
      })
    ) continue;

    const rebased = rebasePausedSchedule(
      pausedRows.map((row) => String(row.send_at)),
      now + 60_000,
    );
    for (let index = 0; index < pausedRows.length; index++) {
      await db.from("scheduled_messages").update({
        status: "pending",
        send_at: rebased[index],
      }).eq("id", pausedRows[index].id);
    }
    await db.from("sales_sequences").update({ status: "running" })
      .eq("id", sequence.id);
    await db.from("events").insert({
      source: "funil",
      event_type: "auto_resumed",
      payload: {
        conversation_id: conversationId,
        chatwoot_conversation_id: sequence.chatwoot_conversation_id,
        reason: "90min-sem-atividade",
        resumed_messages: pausedRows.length,
      },
    });
    result.resumed++;
  }
  return result;
}

async function scheduleSilentFollowup(
  db: DbClient,
  sequence: Json,
  lastSentAt: number,
  now: number,
): Promise<boolean> {
  const conversationId = String(sequence.conversation_id);
  const conversation = await db.from("conversations")
    .select("outcome")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversation.data?.outcome) return false;

  const activity = await latestActivity(db, conversationId);
  if (
    !activity.lastInboundAt || activity.lastInboundAt > lastSentAt ||
    (activity.lastActivityAt && activity.lastActivityAt > lastSentAt)
  ) {
    return false;
  }
  if (now - activity.lastInboundAt > MAX_CONTACT_AGE_MS) return false;
  const { data: existing } = await db.from("scheduled_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("funnel", FOLLOW_UP_FUNNEL)
    .limit(1)
    .maybeSingle();
  if (existing) return false;

  const desiredAt = Math.max(now + 60_000, lastSentAt + FOLLOW_UP_AFTER_MS);
  const latestSafeAt = activity.lastInboundAt + MAX_CONTACT_AGE_MS;
  if (desiredAt > latestSafeAt) return false;
  const { error } = await db.from("scheduled_messages").insert({
    conversation_id: conversationId,
    chatwoot_conversation_id: sequence.chatwoot_conversation_id,
    funnel: FOLLOW_UP_FUNNEL,
    day: 6,
    step: 100,
    type: "interactive",
    payload: {
      text:
        "Oi! O senhor conseguiu ver as informações e os vídeos do Mega Sorgo? Ficou alguma dúvida sobre preço, plantio ou produção? Posso te ajudar por aqui. 🙌",
      buttons: [
        { id: "menu_preco", title: "Ver preço 💰" },
        { id: "menu_depoimento", title: "Assistir vídeos 🎬" },
        { id: "menu_humano", title: "Falar com Cícero" },
      ],
    },
    send_at: new Date(desiredAt).toISOString(),
    status: "pending",
  });
  if (error) throw error;
  await db.from("events").insert({
    source: "funil",
    event_type: "followup_scheduled",
    payload: {
      conversation_id: conversationId,
      chatwoot_conversation_id: sequence.chatwoot_conversation_id,
      send_at: new Date(desiredAt).toISOString(),
    },
  });
  return true;
}

async function latestActivity(db: DbClient, conversationId: string) {
  const [{ data: latest }, { data: inbound }] = await Promise.all([
    db.from("messages").select("sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("messages").select("sent_at")
      .eq("conversation_id", conversationId).eq("direction", "in")
      .order("sent_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    lastActivityAt: latest?.sent_at ? Date.parse(String(latest.sent_at)) : null,
    lastInboundAt: inbound?.sent_at
      ? Date.parse(String(inbound.sent_at))
      : null,
  };
}

function latestTimestamp(values: string[]): number {
  return Math.max(
    ...values.map((value) => Date.parse(value)).filter(Number.isFinite),
  );
}
