import type { DbClient } from "./supabase.ts";
import { addBusinessSeconds, clampBusinessTime } from "./business-time.ts";
import { isClosedOutcome } from "./outcome-labels.ts";
import { mutedConversationIds } from "./bot-mute.ts";

type Json = Record<string, unknown>;

const AUTO_RESUME_AFTER_MS = 90 * 60_000;
const MAX_CONTACT_AGE_MS = 72 * 60 * 60_000;
const MAX_AUTO_RESUME_INBOUND_AGE_MS = 6 * 60 * 60_000;
const FOLLOW_UP_AFTER_SECONDS = 10 * 60 * 60;
const FOLLOW_UP_FUNNEL = "mega-sorgo-followup";
const FAILED_GRACE_MS = 24 * 60 * 60_000;
const POSTGREST_ID_BATCH_SIZE = 10;

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

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

/**
 * Retoma a sequência pausada reprogramando o que sobrou.
 *
 * O `send_at` das pausadas ficou no passado enquanto o funil esteve parado. Voltar as
 * linhas para `pending` sem tocar na data faz o pump considerar todas vencidas e despejar
 * o resto do roteiro no cliente em poucos minutos — quanto mais tempo pausado, pior a
 * rajada. `rebasePausedSchedule` reancora em `now + 60s` preservando os intervalos
 * originais entre as peças.
 *
 * O auto-resume já fazia isso; o `resume` manual do funil-control não, e era o caminho que
 * o atendente usa. Virou função compartilhada para os dois não divergirem de novo.
 * O evento fica com o chamador: o motivo da retomada é diferente em cada caso.
 */
export async function resumeSequenceRebased(
  db: DbClient,
  conversationId: string,
  funnel = "mega-sorgo",
  now = Date.now(),
): Promise<number> {
  const { data: paused, error } = await db.from("scheduled_messages")
    .select("id,send_at")
    .eq("conversation_id", conversationId)
    .eq("funnel", funnel)
    .eq("status", "paused")
    .order("send_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  const rows = (paused ?? []) as Json[];
  if (!rows.length) return 0;

  const rebased = rebasePausedSchedule(
    rows.map((row) => String(row.send_at)),
    now + 60_000,
  );
  for (let index = 0; index < rows.length; index++) {
    await db.from("scheduled_messages").update({
      status: "pending",
      send_at: rebased[index],
    }).eq("id", rows[index].id);
  }
  await db.from("sales_sequences").update({ status: "running" })
    .eq("conversation_id", conversationId)
    .eq("funnel", funnel)
    .eq("status", "paused");
  return rows.length;
}

export function canAutoResume(input: {
  now: number;
  pauseAt: number;
  lastActivityAt: number;
  lastInboundAt: number;
  pauseType: string;
  outcome?: string | null;
}): boolean {
  // isClosedOutcome, não `!outcome`: conversations.outcome é NOT NULL com default 'open',
  // então `!outcome` era falso pra TODA conversa e o auto-resume parou de existir.
  return input.pauseType === "auto_paused" && !isClosedOutcome(input.outcome) &&
    input.now - input.pauseAt >= AUTO_RESUME_AFTER_MS &&
    input.now - input.lastActivityAt >= AUTO_RESUME_AFTER_MS &&
    input.now - input.lastInboundAt <= MAX_AUTO_RESUME_INBOUND_AGE_MS;
}

/**
 * Mensagem que ainda segura o funil aberto. `failed` conta só enquanto é recente: não
 * existe retry automático — funnel-queue marca 'failed' e segue — então uma falha velha
 * nunca sai sozinha da fila e a sequência nunca chega a `remaining.length === 0`. Como é
 * a transição para `completed` que agenda o follow-up e libera o lead para a cadeia de
 * recuperação, o lead ficava em limbo: sem funil, sem follow-up, sem recuperação. Em
 * 08/08 eram 16 das 28 sequências `running` travadas assim, a mais antiga desde 15/07.
 */
export function stillBlocksCompletion(
  row: { status?: unknown; send_at?: unknown; sent_at?: unknown },
  now: number,
): boolean {
  const status = String(row.status ?? "");
  if (status === "pending" || status === "paused") return true;
  if (status !== "failed") return false;
  // send_at primeiro: quem falhou nunca chegou a ter sent_at.
  const at = Date.parse(String(row.send_at ?? row.sent_at ?? ""));
  return !Number.isFinite(at) || now - at < FAILED_GRACE_MS;
}

export function silentFollowupAt(lastSentAt: number, now: number): number {
  return clampBusinessTime(Math.max(
    now + 60_000,
    addBusinessSeconds(lastSentAt, FOLLOW_UP_AFTER_SECONDS),
  ));
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

  const conversationIds = sequences.map((item: Json) => String(item.conversation_id))
    .filter(Boolean);
  const idBatches = batches(conversationIds, POSTGREST_ID_BATCH_SIZE);
  const since = new Date(now - 48 * 60 * 60_000).toISOString();
  const [conversationBatches, pauseEventsResult, catalogStateBatches] = await Promise.all([
    Promise.all(idBatches.map((ids) => db.from("conversations")
      .select("id,channel_id,outcome")
      .in("id", ids))),
    db.from("events")
      .select("event_type,received_at,payload")
      .eq("source", "funil")
      .in("event_type", ["auto_paused", "manual_paused"])
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(2_000),
    Promise.all(idBatches.map((ids) => db.from("catalog_nav_state")
      .select("conversation_id")
      .in("conversation_id", ids)
      .eq("journey", "catalogo"))),
  ]);
  for (const response of [...conversationBatches, ...catalogStateBatches]) {
    if (response.error) throw response.error;
  }
  if (pauseEventsResult.error) throw pauseEventsResult.error;
  const conversations = conversationBatches.flatMap((response) => response.data ?? []);
  const pauseEvents = pauseEventsResult.data;
  const catalogStates = catalogStateBatches.flatMap((response) => response.data ?? []);
  const conversationMap = new Map(
    (conversations ?? []).map((item: Json) => [String(item.id), item]),
  );
  const catalogConversationIds = new Set(
    (catalogStates ?? []).map((item: Json) => String(item.conversation_id)),
  );
  // Conversa com bot travado não retoma sozinha nem ganha follow-up: destravar é ato
  // deliberado do atendente, e é o loop do bot-off que reprograma a fila ao destravar.
  const muted = await mutedConversationIds(
    db,
    conversationIds.map((id: unknown) => String(id)),
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
    if (muted.has(conversationId)) continue;
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
    const remaining = rows.filter((row) => stillBlocksCompletion(row, now));
    // Falhas velhas deixaram de segurar o funil, mas o lead não recebeu essas mensagens:
    // registrar quantas para o evento não sugerir uma entrega completa.
    const abandoned = rows.filter((row) =>
      String(row.status) === "failed" && !stillBlocksCompletion(row, now)
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
          abandoned_messages: abandoned.length,
          last_sent_at: new Date(lastSentAt).toISOString(),
        },
      });
      result.completed++;
      if (
        !catalogConversationIds.has(conversationId) &&
        await scheduleSilentFollowup(db, sequence, lastSentAt, now)
      ) {
        result.followups++;
      }
      continue;
    }

    if (sequence.status !== "paused") continue;
    if (catalogConversationIds.has(conversationId)) continue;
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
  // Era `if (conversation.data?.outcome)`: como a coluna vem 'open' por padrão, isso
  // barrava todo mundo — 135 funis concluídos e nenhum follow-up agendado.
  if (isClosedOutcome(conversation.data?.outcome as string | null)) {
    return false;
  }

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

  const desiredAt = silentFollowupAt(lastSentAt, now);
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
