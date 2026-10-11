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

/** Lista IDs, nunca payload, para o workflow não carregar conteúdo nem segredo do banco. */
async function due(): Promise<Response> {
  if (!isWithinFunnelSendHours()) return json([]);
  const db = admin();
  const now = new Date().toISOString();
  const versions = [RESTORED_5895_FUNNEL, SOCIAL_N8N_FUNNEL];
  const results = await Promise.all(versions.flatMap((version) =>
    [true, false].map((ascending) => db.from("scheduled_messages")
      .select("id,conversation_id,send_at,funnel")
      .eq("status", "pending")
      .like("funnel", `${version}%`)
      .lte("send_at", now)
      .order("send_at", { ascending }).limit(SCAN_PER_EDGE))
  ));
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
    ...rows.filter((row) => String(row.funnel).startsWith(RESTORED_5895_FUNNEL)).slice(0, QUEUE_LIMIT / 2),
    ...rows.filter((row) => String(row.funnel).startsWith(SOCIAL_N8N_FUNNEL)).slice(0, QUEUE_LIMIT / 2),
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
  if (!isWithinFunnelSendHours()) {
    return json({ ok: true, sent: false, blocked: "horario-comercial" });
  }
  const db = admin();
  const { data: row, error: rowError } = await db.from("scheduled_messages")
    .select("id,conversation_id,chatwoot_conversation_id,funnel,day,step,type,payload,send_at,status")
    .eq("id", id).maybeSingle();
  if (rowError) return json({ ok: false, error: "falha ao consultar peça" }, 503);
  if (!row || !queueBaseVersion(row.funnel)) {
    return json({ ok: false, error: "peça n8n não encontrada" }, 404);
  }
  if (row.status === "sent") return json({ ok: true, sent: true, duplicate: true });
  if (row.status !== "pending") {
    return json({ ok: true, sent: false, blocked: "peça não pendente" });
  }
  if (Date.parse(String(row.send_at)) > Date.now()) {
    return json({ ok: true, sent: false, not_due: true });
  }
  const { data: conversation, error: conversationError } = await db.from("conversations")
    .select("id,channel_id,chatwoot_conversation_id")
    .eq("id", row.conversation_id).maybeSingle();
  if (conversationError || !conversation ||
    Number(conversation.chatwoot_conversation_id) !== Number(row.chatwoot_conversation_id)) {
    return json({ ok: false, error: "conversa inválida" }, 422);
  }
  const { data: channel, error: channelError } = await db.from("channels")
    .select("id,type,name,external_id,phone_number")
    .eq("id", conversation.channel_id).maybeSingle();
  if (channelError || !channel ||
    funnelVersionForChannel(channel) !== queueBaseVersion(row.funnel)) {
    return json({ ok: false, error: "canal ou versão não autorizada" }, 422);
  }
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
