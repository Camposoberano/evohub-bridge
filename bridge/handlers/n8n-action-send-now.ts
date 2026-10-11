/** Sends only the first due piece of an n8n-authored 5895 action. The cron is fallback. */
import { actionKey, isSoberanoAction, type ActionRequest } from "../shared/n8n-action-contract.ts";
import { RESTORED_5895_FUNNEL } from "../shared/funnel-identity.ts";
import { isWithinFunnelSendHours } from "../shared/business-hours.ts";
import { admin, claimDeliveryWithTtl } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { canalAlvoFunil } from "../shared/funil-anuncio.ts";
import { isContactBlocked, isContactExcludedFromAutomation } from "../shared/lead-block.ts";
import { bloqueioDaConversa, motivoDoBloqueio } from "../shared/gate-comercial.ts";
import { handle as sendOutbound } from "./send-outbound.ts";

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function validImmediateRequest(value: unknown):
  | { ok: true; messageId: string; request: ActionRequest }
  | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "body inválido" };
  }
  const body = value as Json;
  const request = body.request as Json | undefined;
  if (
    typeof body.scheduled_message_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(body.scheduled_message_id) ||
    !request || typeof request !== "object" ||
    typeof request.request_id !== "string" || !request.request_id ||
    !Number.isInteger(request.chatwoot_conversation_id) ||
    !isSoberanoAction(String(request.action ?? "")) ||
    request.funnel_version !== RESTORED_5895_FUNNEL
  ) return { ok: false, error: "solicitação inválida" };
  return {
    ok: true,
    messageId: body.scheduled_message_id,
    request: request as ActionRequest,
  };
}

async function releaseClaim(db: ReturnType<typeof admin>, claimKey: string) {
  const { error } = await db.from("deliveries").delete().eq("delivery_id", claimKey);
  if (error) console.error("n8n immediate: falha ao liberar claim", error);
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const secret = optionalEnv("N8N_ACTION_SECRET");
  if (!secret) return json({ ok: false, error: "integração n8n não configurada" }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!confereSegredo(token, [secret], "n8n-action-send-now")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const parsed = validImmediateRequest(await req.json().catch(() => null));
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const { messageId, request } = parsed;
  if (["pause", "resume", "stop", "catalogo", "catalogo-sair"].includes(request.action)) {
    return json({ ok: false, error: "ação sem peça" }, 422);
  }
  if (!isWithinFunnelSendHours()) {
    return json({ ok: true, sent: false, blocked: "horario-comercial" });
  }

  const db = admin();
  const { data: row, error: rowError } = await db.from("scheduled_messages")
    .select("id,conversation_id,chatwoot_conversation_id,funnel,day,step,type,payload,send_at,status")
    .eq("id", messageId).maybeSingle();
  if (rowError) return json({ ok: false, error: "falha ao consultar peça" }, 503);
  if (!row) return json({ ok: false, error: "peça não encontrada" }, 404);
  const expectedFunnel = request.action === "funil"
    ? RESTORED_5895_FUNNEL
    : `${RESTORED_5895_FUNNEL}:${request.action}`;
  const payload = row.payload && typeof row.payload === "object"
    ? row.payload as Json
    : {};
  if (
    row.funnel !== expectedFunnel || row.step !== 0 ||
    Number(row.chatwoot_conversation_id) !== request.chatwoot_conversation_id ||
    payload.__funnel_sequence_id !== actionKey(request)
  ) return json({ ok: false, error: "peça não pertence à solicitação" }, 422);
  if (row.status === "sent") return json({ ok: true, sent: true, duplicate: true });
  if (row.status !== "pending") return json({ ok: true, sent: false, blocked: "peça não pendente" });
  if (Date.parse(String(row.send_at)) > Date.now()) {
    return json({ ok: true, sent: false, not_due: true });
  }

  const { data: conversation, error: conversationError } = await db.from("conversations")
    .select("id,channel_id,outcome,labels,bot_muted_at,contacts(*)")
    .eq("id", row.conversation_id).maybeSingle();
  if (conversationError || !conversation) {
    return json({ ok: false, error: "falha ao consultar conversa" }, 503);
  }
  const { data: channel, error: channelError } = await db.from("channels")
    .select("id,name,external_id,phone_number")
    .eq("id", conversation.channel_id).maybeSingle();
  if (channelError || !channel || !canalAlvoFunil(channel, "5895")) {
    return json({ ok: false, error: "canal inválido" }, 422);
  }
  if (isContactBlocked(conversation.contacts) ||
    isContactExcludedFromAutomation(conversation.contacts)) {
    return json({ ok: true, sent: false, blocked: "contato excluído" });
  }
  const commercialBlock = bloqueioDaConversa(conversation);
  if (commercialBlock) {
    return json({ ok: true, sent: false, blocked: motivoDoBloqueio(commercialBlock) });
  }
  if (conversation.bot_muted_at) {
    return json({ ok: true, sent: false, blocked: "atendimento-humano" });
  }

  const claimKey = `funnel-queue-${messageId}`;
  if (!await claimDeliveryWithTtl(db, claimKey, "n8n-immediate", 10 * 60_000)) {
    return json({ ok: true, sent: false, in_progress: true });
  }
  let sent = false;
  try {
    const result = await sendOutbound(new Request(
      `http://internal/send-outbound?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatwoot_conversation_id: request.chatwoot_conversation_id,
          type: row.type,
          payload,
          funnel: row.funnel,
          funnel_day: row.day,
          funnel_step: row.type,
          scheduled_message_id: messageId,
        }),
      },
    ));
    const outcome = await result.json().catch(() => ({} as Json)) as Json;
    if (result.ok && outcome.ok === true && outcome.sent === true) {
      // send-outbound gravou funnel-sent-{id}; preserve the claim even if a
      // later DB update fails, so the cron can reconcile without a second send.
      sent = true;
      const sentAt = new Date().toISOString();
      const { error: sentError } = await db.from("scheduled_messages")
        .update({ status: "sent", sent_at: sentAt })
        .eq("id", messageId).eq("status", "pending");
      if (sentError) throw sentError;
      await db.from("sales_sequences")
        .update({ current_day: row.day, last_sent_at: sentAt })
        .eq("conversation_id", row.conversation_id)
        .eq("funnel", row.funnel).in("status", ["running", "paused"]);
      await db.from("events").insert({
        source: "funil",
        event_type: "n8n_immediate_sent",
        channel_id: channel.id,
        payload: {
          conversation_id: row.conversation_id,
          scheduled_message_id: messageId,
          action: request.action,
          due_at: row.send_at,
          sent_at: sentAt,
          latency_ms: Date.now() - Date.parse(String(row.send_at)),
        },
      });
      return json({ ok: true, sent: true, scheduled_message_id: messageId });
    }
    return json({
      ok: result.ok,
      sent: false,
      blocked: typeof outcome.blocked === "string" ? outcome.blocked : undefined,
      uncertain: outcome.uncertain === true,
      retry_scheduled: outcome.retry_scheduled === true,
    }, result.ok ? 200 : result.status);
  } catch (error) {
    console.error("n8n immediate: envio falhou", messageId, error);
    return json({ ok: false, sent: false, error: "falha no envio imediato" }, 503);
  } finally {
    if (!sent) await releaseClaim(db, claimKey);
  }
}
