// Consumidor de contingencia da fila do funil.
// O claim em deliveries evita duplicacao se o n8n e este loop enxergarem a mesma linha.
import { admin, claimDelivery } from "./supabase.ts";
import { env } from "./env.ts";
import { handle as sendOutbound } from "../handlers/send-outbound.ts";
import { mutedConversationIds } from "./bot-mute.ts";

type Json = Record<string, unknown>;

let running = false;
const BRT_OFFSET_MINUTES = 180;
const WINDOW_HOLD_FLAG = "__awaiting_meta_window";

/** Reabre somente peças retidas pela janela Meta após nova entrada do cliente. */
export async function resumeWindowHeldMessages(
  db: ReturnType<typeof admin>,
  conversationId: string,
  now = Date.now(),
): Promise<number> {
  const { data, error } = await db.from("scheduled_messages")
    .select("id,payload")
    .eq("conversation_id", conversationId)
    .eq("status", "paused")
    .limit(500);
  if (error) throw error;
  let resumed = 0;
  for (const row of (data ?? []) as Json[]) {
    const payload = row.payload && typeof row.payload === "object"
      ? row.payload as Json
      : {};
    if (payload[WINDOW_HOLD_FLAG] !== true) continue;
    const nextPayload = { ...payload };
    delete nextPayload[WINDOW_HOLD_FLAG];
    await db.from("scheduled_messages").update({
      status: "pending",
      send_at: new Date(now + 60_000).toISOString(),
      payload: nextPayload,
    }).eq("id", row.id);
    resumed++;
  }
  if (resumed) {
    await db.from("events").insert({
      source: "funil",
      event_type: "window_held_resumed",
      payload: { conversation_id: conversationId, resumed_messages: resumed },
    });
  }
  return resumed;
}

export function businessShiftMinutes(values: string[]): number {
  const minutes = values.map((value) => {
    const date = new Date(value);
    const brt = new Date(date.getTime() - BRT_OFFSET_MINUTES * 60_000);
    return brt.getUTCHours() * 60 + brt.getUTCMinutes();
  });
  if (!minutes.length) return 0;
  const min = Math.min(...minutes);
  const max = Math.max(...minutes);
  if (min < 6 * 60) return 6 * 60 - min;
  if (max >= 22 * 60) return 24 * 60 - min + 6 * 60;
  return 0;
}

async function normalizeBusinessQueue(
  db: ReturnType<typeof admin>,
): Promise<number> {
  const { data, error } = await db.from("scheduled_messages")
    .select("id,conversation_id,day,send_at,status")
    .in("status", ["pending", "paused"]).order("send_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  const groups = new Map<string, Json[]>();
  for (const row of (data ?? []) as Json[]) {
    const key = `${row.conversation_id}:${row.day}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let shifted = 0;
  for (const rows of groups.values()) {
    const delta = businessShiftMinutes(rows.map((row) => String(row.send_at)));
    if (!delta) continue;
    for (const row of rows) {
      const sendAt = new Date(
        new Date(String(row.send_at)).getTime() + delta * 60_000,
      ).toISOString();
      await db.from("scheduled_messages").update({ send_at: sendAt }).eq(
        "id",
        row.id,
      );
      shifted++;
    }
  }
  return shifted;
}

/**
 * Guarda por que a mensagem não saiu. Sem isto o motivo se perdia: a linha virava
 * 'failed' e o corpo da resposta era descartado — 71 mensagens ficaram assim desde
 * 15/07 sem que desse pra dizer se foi janela da Meta, canal sem token ou 502 do
 * Chatwoot, e não havia como decidir se valia retentar. Falha silenciosa também foi o
 * que deixou 16 sequências travadas por 24 dias sem ninguém notar.
 *
 * Nunca propaga erro: instrumentação que derruba o envio é pior que a falta dela.
 */
async function recordFailure(
  db: ReturnType<typeof admin>,
  scheduledMessageId: string,
  row: Json,
  httpStatus: number,
  body: Json,
): Promise<void> {
  const motivo = typeof body.blocked === "string"
    ? `blocked:${body.blocked}`
    : typeof body.error === "string"
    ? body.error.slice(0, 300)
    : JSON.stringify(body ?? {}).slice(0, 300);
  console.error(
    `funnel-queue: falha msg=${scheduledMessageId} conv=${
      row.chatwoot_conversation_id ?? "?"
    } dia=${row.day ?? "?"} http=${httpStatus} motivo=${motivo}`,
  );
  try {
    await db.from("events").insert({
      source: "funil",
      event_type: "message_failed",
      payload: {
        scheduled_message_id: scheduledMessageId,
        conversation_id: row.conversation_id ?? null,
        chatwoot_conversation_id: row.chatwoot_conversation_id ?? null,
        funnel: row.funnel ?? "mega-sorgo",
        day: row.day ?? null,
        type: row.type ?? "text",
        http_status: httpStatus,
        // separado de `motivo` pra dar pra agrupar bloqueio por janela sem parsear texto
        blocked: typeof body.blocked === "string" ? body.blocked : null,
        motivo,
      },
    });
  } catch (e) {
    console.error("funnel-queue: nao consegui registrar a falha:", e);
  }
}

export async function pumpFunnelQueue(
  limit = 10,
): Promise<
  { found: number; sent: number; failed: number; held: number }
> {
  if (running) return { found: 0, sent: 0, failed: 0, held: 0 };
  running = true;
  try {
    const db = admin();
    await normalizeBusinessQueue(db);
    const now = new Date().toISOString();
    const { data, error } = await db.from("scheduled_messages")
      .select(
        "id,conversation_id,chatwoot_conversation_id,funnel,day,type,payload,send_at",
      )
      .eq("status", "pending")
      .lte("send_at", now)
      .order("send_at", { ascending: true })
      .limit(limit);
    if (error) throw error;

    // Quem já comprou não recebe mais isca. A etiqueta "pago"/"venda" no Chatwoot ou no
    // Tanto venda quanto recusa encerram a automação. A etiqueta/recusa pode ser processada
    // em outro loop antes deste pump; esta trava independente evita qualquer corrida residual.
    const stopOutcomes = ["won", "lost"];
    const convIds: string[] = [
      ...new Set<string>(
        (data ?? []).map((row: Json) => String(row.conversation_id ?? ""))
          .filter(Boolean),
      ),
    ];
    const closed = new Set<string>();
    if (convIds.length) {
      const { data: convs } = await db.from("conversations")
        .select("id,outcome").in("id", convIds).in("outcome", stopOutcomes);
      for (const c of (convs ?? []) as Json[]) closed.add(String(c.id));
    }
    // Bot travado na conversa (label bot-off): a peça fica esperando, não é cancelada nem
    // marcada como falha. Marcar 'failed' aqui recriaria o defeito que travou 16
    // sequências por 24 dias — falha segura a conclusão do funil e o lead some dos dois
    // sistemas. Ao destravar, resumeSequenceRebased reprograma o que ficou parado.
    const muted = await mutedConversationIds(db, convIds);

    let sent = 0;
    let failed = 0;
    let cancelled = 0;
    let held = 0;
    for (const row of (data ?? []) as Json[]) {
      const id = String(row.id ?? "");
      if (!id) continue;

      if (closed.has(String(row.conversation_id ?? ""))) {
        await db.from("scheduled_messages")
          .update({ status: "cancelled" }).eq("id", id);
        cancelled++;
        continue;
      }

      if (muted.has(String(row.conversation_id ?? ""))) {
        held++;
        continue;
      }

      const claimKey = `funnel-queue-${id}`;
      if (!await claimDelivery(db, claimKey, "funnel-queue")) continue;

      const payload = (row.payload && typeof row.payload === "object")
        ? row.payload as Json
        : {};
      const res = await sendOutbound(
        new Request(
          `http://internal/send-outbound?token=${
            encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))
          }`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatwoot_conversation_id: Number(row.chatwoot_conversation_id),
              type: String(row.type ?? "text"),
              payload,
              // Elo pra messages.funnel/funnel_day/funnel_step/scheduled_message_id (migration
              // 0012) -- sem isso o relatório não consegue dizer qual peça da sequência gerou
              // qual resposta do lead.
              funnel: row.funnel ?? "mega-sorgo",
              funnel_day: row.day ?? null,
              funnel_step: row.type ?? null,
              scheduled_message_id: id,
            }),
          },
        ),
      );
      const body = await res.json().catch(() => ({} as Json));
      if (res.ok && body.ok !== false && !body.blocked) {
        const sentAt = new Date().toISOString();
        await db.from("scheduled_messages").update({
          status: "sent",
          sent_at: sentAt,
        }).eq("id", id);
        await db.from("sales_sequences").update({
          current_day: Number(row.day ?? 0),
          last_sent_at: sentAt,
        }).eq("conversation_id", row.conversation_id)
          .eq("funnel", row.funnel ?? "mega-sorgo")
          .in("status", ["running", "paused"]);
        sent++;
      } else if (
        body.awaiting_window === true ||
        body.blocked === "janela-fechada" ||
        body.blocked === "rota-hibrida-indisponivel-e-janela-fechada"
      ) {
        await db.from("scheduled_messages").update({
          status: "paused",
          payload: { ...payload, [WINDOW_HOLD_FLAG]: true },
        }).eq("id", id);
        await db.from("deliveries").delete().eq("delivery_id", claimKey);
        await db.from("events").insert({
          source: "funil",
          event_type: "message_held_window",
          payload: {
            scheduled_message_id: id,
            conversation_id: row.conversation_id ?? null,
            chatwoot_conversation_id: row.chatwoot_conversation_id ?? null,
            funnel: row.funnel ?? "mega-sorgo",
            day: row.day ?? null,
            type: row.type ?? "text",
            janela: body.janela ?? null,
          },
        });
        held++;
      } else {
        await db.from("scheduled_messages").update({ status: "failed" }).eq(
          "id",
          id,
        );
        await db.from("deliveries").delete().eq("delivery_id", claimKey);
        await recordFailure(db, id, row, res.status, body);
        failed++;
      }
    }
    if (cancelled > 0) {
      console.log(
        "funnel-queue: canceladas",
        cancelled,
        "msg(s) de conversa ja fechada",
      );
    }
    if (held > 0) {
      console.log("funnel-queue: seguradas", held, "msg(s) com bot travado");
    }
    return { found: data?.length ?? 0, sent, failed, held };
  } finally {
    running = false;
  }
}
