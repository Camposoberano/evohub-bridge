import { admin } from "../shared/supabase.ts";
import { optionalEnv, env } from "../shared/env.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";
import {
  RESTORED_5895_FUNNEL,
  SOCIAL_N8N_FUNNEL,
  funnelVersionForChannel,
} from "../shared/funnel-identity.ts";
import { isN8nManagedFunnel } from "../shared/social-window-hold.ts";
import { isWithinFunnelSendHours } from "../shared/business-hours.ts";
import { handle as sendOutbound } from "./send-outbound.ts";
import { isContactBlocked, isContactExcludedFromAutomation } from "../shared/lead-block.ts";
import { bloqueioDaConversa, motivoDoBloqueio } from "../shared/gate-comercial.ts";
import { MEGA_SORGO_7D_VERSION } from "../shared/mega-sorgo-7d-content.ts";
import { isSevenDayWhatsAppChannel, sevenDayTestConversationAllowed } from "../shared/mega-sorgo-7d-gate.ts";
import { isSevenDaySendHour } from "../shared/mega-sorgo-7d-schedule.ts";
import { isSevenDayNightTest, isSevenDayNightTestWindow } from "../shared/mega-sorgo-7d-night-test.ts";
import { transitionSevenDaySequence } from "../shared/mega-sorgo-7d-state.ts";

type Json = Record<string, unknown>;
const QUEUE_LIMIT = 200;
const SCAN_PER_EDGE = 500;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function queueBaseVersion(funnel: unknown): string | null {
  if (!isN8nManagedFunnel(funnel)) return null;
  return String(funnel).split(":")[0];
}

export function queueBlockReason(conversation: {
  contacts?: Record<string, unknown> | null;
  outcome?: unknown;
  labels?: unknown;
  bot_muted_at?: unknown;
}): string | null {
  if (isContactBlocked(conversation.contacts) ||
    isContactExcludedFromAutomation(conversation.contacts)) return "contato excluído";
  const commercialBlock = bloqueioDaConversa(conversation);
  if (commercialBlock) return motivoDoBloqueio(commercialBlock);
  if (conversation.bot_muted_at) return "atendimento-humano";
  return null;
}

/** Só um desfecho comercial definitivo encerra a peça do 5895. */
export function shouldCancelTerminal5895(funnel: unknown, blocked: string | null): boolean {
  return queueBaseVersion(funnel) === RESTORED_5895_FUNNEL &&
    (blocked === "nao-compra" || blocked === "ja-comprou");
}

/** Lista IDs, nunca payload, para o workflow não carregar conteúdo nem segredo do banco. */
async function due(): Promise<Response> {
  if (!isWithinFunnelSendHours()) {
    if (!isSevenDayNightTestWindow()) return json([]);
    const db = admin();
    const { data, error } = await db.from("scheduled_messages")
      .select("id,chatwoot_conversation_id")
      .eq("status", "pending").eq("funnel", MEGA_SORGO_7D_VERSION)
      .in("chatwoot_conversation_id", [5004, 5005])
      .lte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true }).limit(20);
    if (error) return json({ ok: false, error: "falha ao consultar teste noturno" }, 503);
    return json(((data ?? []) as Json[])
      .filter((row: Json) => isSevenDayNightTest(Number(row.chatwoot_conversation_id)))
      .map((row: Json) => ({ id: row.id })));
  }
  const db = admin();
  const now = new Date().toISOString();
  const versions = [RESTORED_5895_FUNNEL, SOCIAL_N8N_FUNNEL,
    ...(isSevenDaySendHour() ? [MEGA_SORGO_7D_VERSION] : [])];
  const results = [];
  // A VPS tem 2 vCPU; uma versão adicional não deve dobrar a rajada de consultas.
  for (const version of versions) {
    results.push(...await Promise.all([true, false].map((ascending) => db.from("scheduled_messages")
      .select("id,conversation_id,send_at,funnel")
      .eq("status", "pending")
      .like("funnel", `${version}%`)
      .lte("send_at", now)
      .order("send_at", { ascending }).limit(SCAN_PER_EDGE))));
  }
  if (results.some((result) => result.error)) {
    return json({ ok: false, error: "falha ao consultar fila" }, 503);
  }
  const unique = new Map<string, Json>();
  for (const result of results) {
    for (const row of (result.data ?? []) as Json[]) unique.set(String(row.id), row);
  }
  const seenConversations = new Set<string>();
  const rows = [...unique.values()]
    .filter((row: Json) => isN8nManagedFunnel(row.funnel))
    .sort((a: Json, b: Json) =>
      Date.parse(String(a.send_at)) - Date.parse(String(b.send_at)))
    .filter((row: Json) => {
      const conversationId = String(row.conversation_id);
      if (seenConversations.has(conversationId)) return false;
      seenConversations.add(conversationId);
      return true;
    });
  const selected = [
    ...rows.filter((row) => String(row.funnel).startsWith(RESTORED_5895_FUNNEL)).slice(0, 90),
    ...rows.filter((row) => String(row.funnel).startsWith(SOCIAL_N8N_FUNNEL)).slice(0, 90),
    ...rows.filter((row) => String(row.funnel).startsWith(MEGA_SORGO_7D_VERSION)).slice(0, 20),
  ];
  const selectedIds = new Set(selected.map((row) => String(row.id)));
  for (const row of rows) {
    if (selected.length >= QUEUE_LIMIT) break;
    if (!selectedIds.has(String(row.id))) selected.push(row);
  }
  const ids = selected
    .map((row: Json) => ({ id: row.id }));
  return json(ids);
}

/** Envia somente uma peça existente após resolver sua conversa e seu canal reais. */
async function send(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as Json | null;
  const id = String(body?.scheduled_message_id ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id)) {
    return json({ ok: false, error: "scheduled_message_id inválido" }, 400);
  }
  const db = admin();
  const { data: row, error: rowError } = await db.from("scheduled_messages")
    .select("id,conversation_id,chatwoot_conversation_id,funnel,day,step,type,payload,send_at,status")
    .eq("id", id).maybeSingle();
  if (rowError) return json({ ok: false, error: "falha ao consultar peça" }, 503);
  if (!row || !queueBaseVersion(row.funnel)) {
    return json({ ok: false, error: "peça n8n não encontrada" }, 404);
  }
  const isSevenDay = queueBaseVersion(row.funnel) === MEGA_SORGO_7D_VERSION;
  const nightTest = isSevenDay && isSevenDayNightTest(Number(row.chatwoot_conversation_id));
  if (!isWithinFunnelSendHours() && !nightTest) {
    return json({ ok: true, sent: false, blocked: "horario-comercial" });
  }
  if (row.status === "sent") return json({ ok: true, sent: true, duplicate: true });
  if (row.status !== "pending") {
    return json({ ok: true, sent: false, blocked: "peça não pendente" });
  }
  if (Date.parse(String(row.send_at)) > Date.now()) {
    return json({ ok: true, sent: false, not_due: true });
  }
  if (isSevenDay && ((!isSevenDaySendHour() && !nightTest) ||
    !sevenDayTestConversationAllowed(Number(row.chatwoot_conversation_id)))) {
    return json({ ok: true, sent: false, blocked: "teste-7d-nao-autorizado" });
  }
  const { data: conversation, error: conversationError } = await db.from("conversations")
    .select("id,channel_id,chatwoot_conversation_id,outcome,labels,bot_muted_at,contacts(*)")
    .eq("id", row.conversation_id).maybeSingle();
  if (conversationError || !conversation) {
    return json({ ok: false, error: "falha ao consultar conversa" }, 503);
  }
  if (Number(conversation.chatwoot_conversation_id) !== Number(row.chatwoot_conversation_id)) {
    return json({ ok: false, error: "conversa inválida" }, 422);
  }
  const { data: channel, error: channelError } = await db.from("channels")
    .select("id,type,name,external_id,phone_number")
    .eq("id", conversation.channel_id).maybeSingle();
  if (channelError || !channel || (isSevenDay
    ? !isSevenDayWhatsAppChannel(channel)
    : funnelVersionForChannel(channel) !== queueBaseVersion(row.funnel))) {
    return json({ ok: false, error: "canal ou versão não autorizada" }, 422);
  }
  if (isSevenDay) {
    const { data: sequence, error: sequenceError } = await db.from("sales_sequences")
      .select("status").eq("conversation_id", conversation.id)
      .eq("funnel", MEGA_SORGO_7D_VERSION).maybeSingle();
    if (sequenceError || sequence?.status !== "running") {
      return json({ ok: true, sent: false, blocked: "sequencia-7d-pausada" });
    }
  }
  const blocked = queueBlockReason(conversation);
  if (isSevenDay && ["nao-compra", "ja-comprou"].includes(String(blocked))) {
    await transitionSevenDaySequence(db, String(conversation.id), "cancelled", String(blocked));
    return json({ ok: true, sent: false, blocked, cancelled: true });
  }
  if (isSevenDay && blocked === "atendimento-humano") {
    await transitionSevenDaySequence(db, String(conversation.id), "paused", blocked);
    return json({ ok: true, sent: false, blocked });
  }
  if (shouldCancelTerminal5895(row.funnel, blocked)) {
    const { data: cancelled, error: cancelError } = await db.from("scheduled_messages")
      .update({ status: "cancelled" }).eq("id", id).eq("status", "pending")
      .select("id").maybeSingle();
    if (cancelError) return json({ ok: false, error: "falha ao cancelar peça obsoleta" }, 503);
    if (!cancelled) return json({ ok: true, sent: false, blocked: "peça não pendente" });
    const { error: auditError } = await db.from("events").insert({
      source: "n8n-queue",
      event_type: "5895_obsolete_queue_cancelled",
      payload: {
        scheduled_message_id: id,
        chatwoot_conversation_id: row.chatwoot_conversation_id,
        reason: blocked,
      },
    });
    if (auditError) console.error("n8n-queue: falha ao auditar cancelamento", auditError.code);
    return json({ ok: true, sent: false, blocked, cancelled: true });
  }
  if (blocked) return json({ ok: true, sent: false, blocked });
  const result = await sendOutbound(new Request(
    `http://internal/send-outbound?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatwoot_conversation_id: Number(row.chatwoot_conversation_id),
        type: row.type,
        payload: row.payload,
        funnel: row.funnel,
        funnel_day: row.day,
        funnel_step: row.step,
        scheduled_message_id: id,
      }),
    },
  ));
  return new Response(await result.text(), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handle(req: Request): Promise<Response> {
  const secret = optionalEnv("N8N_ACTION_SECRET");
  if (!secret) return json({ ok: false, error: "integração n8n não configurada" }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!confereSegredo(token, [secret], "n8n-queue")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (req.method === "GET") return due();
  if (req.method === "POST") return send(req);
  return json({ ok: false, error: "method not allowed" }, 405);
}
