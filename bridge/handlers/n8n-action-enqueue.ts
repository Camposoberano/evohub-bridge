import {
  actionKey,
  actionUuid,
  isSoberanoAction,
  type ActionRequest,
} from "../shared/n8n-action-contract.ts";
import { RESTORED_5895_FUNNEL } from "../shared/funnel-identity.ts";
import { FIM_ACESSO, GAPS, iniciosDosAcessos } from "./funil-enroll.ts";
import { isWithinFunnelSendHours, nextFunnelSendAt } from "../shared/business-hours.ts";
import { admin, claimDelivery } from "../shared/supabase.ts";
import { optionalEnv, env } from "../shared/env.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { canalAlvoFunil } from "../shared/funil-anuncio.ts";
import {
  isContactBlocked,
  isContactExcludedFromAutomation,
} from "../shared/lead-block.ts";
import { handle as funilControl } from "./funil-control.ts";

type Json = Record<string, unknown>;

export type QueuePiece = {
  day: number;
  type: "text" | "text_sequence" | "image" | "audio" | "video" |
    "interactive" | "list";
  payload: Json;
  offset_seconds: number;
};

export type EnqueueBody = { request: ActionRequest; pieces: QueuePiece[] };

export type ActionQueueRow = {
  id: string;
  conversation_id: string;
  chatwoot_conversation_id: number;
  funnel: string;
  day: number;
  step: number;
  type: QueuePiece["type"];
  payload: Json;
  send_at: string;
  status: "paused";
};

const TYPES = new Set<QueuePiece["type"]>([
  "text", "text_sequence", "image", "audio", "video", "interactive", "list",
]);
const CONTROL_ACTIONS = new Set(["pause", "resume", "stop", "catalogo-sair"]);

export function validateEnqueueBody(
  input: unknown,
): { ok: true; value: EnqueueBody } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "body inválido" };
  const body = input as Json;
  const request = body.request as Json | undefined;
  if (!request || typeof request !== "object") {
    return { ok: false, error: "request obrigatório" };
  }
  const action = String(request.action ?? "");
  if (!isSoberanoAction(action)) return { ok: false, error: "ação desconhecida" };
  if (
    !String(request.request_id ?? "").trim() ||
    String(request.request_id).length > 180 ||
    !Number.isSafeInteger(request.chatwoot_conversation_id) ||
    Number(request.chatwoot_conversation_id) <= 0 ||
    !["macro", "ad"].includes(String(request.source ?? "")) ||
    request.funnel_version !== RESTORED_5895_FUNNEL
  ) return { ok: false, error: "identidade ou versão inválida" };
  if (!Array.isArray(body.pieces)) return { ok: false, error: "pieces obrigatório" };
  const pieces = body.pieces as unknown[];
  const mustBeEmpty = CONTROL_ACTIONS.has(action);
  if (mustBeEmpty && pieces.length !== 0) return { ok: false, error: "controle não aceita peças" };
  if (action === "funil" && pieces.length !== 31) {
    return { ok: false, error: "funil de 30/09 exige 31 peças" };
  }
  if (!mustBeEmpty && action !== "funil" && (pieces.length < 1 || pieces.length > 30)) {
    return { ok: false, error: "quantidade de peças inválida" };
  }
  for (const item of pieces) {
    if (!item || typeof item !== "object") return { ok: false, error: "peça inválida" };
    const p = item as Json;
    if (
      !TYPES.has(p.type as QueuePiece["type"]) ||
      !p.payload || typeof p.payload !== "object" || Array.isArray(p.payload) ||
      !Number.isInteger(p.day) ||
      (action === "funil" ? Number(p.day) < 1 || Number(p.day) > 5 : Number(p.day) !== 0) ||
      !Number.isInteger(p.offset_seconds) || Number(p.offset_seconds) < 0 ||
      Number(p.offset_seconds) > 3_600
    ) return { ok: false, error: "peça inválida" };
  }
  if (action === "funil") {
    const days = pieces.map((p) => Number((p as Json).day));
    if (days.some((day, i) => i > 0 && day < days[i - 1])) {
      return { ok: false, error: "fases fora de ordem" };
    }
    if ([1, 2, 3, 4, 5].some((day) => !days.includes(day))) {
      return { ok: false, error: "faltam fases" };
    }
  }
  return { ok: true, value: body as EnqueueBody };
}

/** Constrói linhas ainda pausadas: a publicação do lote ocorre em etapa separada. */
export async function buildActionRows(
  body: EnqueueBody,
  conversationId: string,
  now = Date.now(),
): Promise<ActionQueueRow[]> {
  if (!conversationId) throw new Error("conversation_id obrigatório");
  const key = actionKey(body.request);
  const starts = body.request.action === "funil"
    ? iniciosDosAcessos(
      now,
      GAPS,
      false,
      body.request.source === "macro",
      FIM_ACESSO,
    )
    : [isWithinFunnelSendHours(now) ? now : nextFunnelSendAt(now)];
  const funnel = body.request.action === "funil"
    ? RESTORED_5895_FUNNEL
    : `${RESTORED_5895_FUNNEL}:${body.request.action}`;
  return await Promise.all(body.pieces.map(async (piece, step) => ({
    id: await actionUuid(`${key}:${step}`),
    conversation_id: conversationId,
    chatwoot_conversation_id: body.request.chatwoot_conversation_id,
    funnel,
    day: piece.day,
    step,
    type: piece.type,
    payload: {
      ...piece.payload,
      __funnel_sequence_id: key,
    },
    send_at: new Date(starts[piece.day > 0 ? piece.day - 1 : 0] +
      piece.offset_seconds * 1000).toISOString(),
    status: "paused" as const,
  })));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Entrada interna dos workflows n8n. Nenhuma peça é emitida neste endpoint. */
export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);
  const secret = optionalEnv("N8N_ACTION_SECRET");
  if (!secret) return json({ ok: false, error: "integração n8n não configurada" }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!confereSegredo(token, [secret], "n8n-action-enqueue")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  const parsed = validateEnqueueBody(await req.json().catch(() => null));
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);
  const body = parsed.value;
  const db = admin();
  const { data: conversation, error: conversationError } = await db
    .from("conversations").select("id,channel_id,contacts(*)")
    .eq("chatwoot_conversation_id", body.request.chatwoot_conversation_id)
    .maybeSingle();
  if (conversationError) return json({ ok: false, error: "falha ao consultar conversa" }, 503);
  if (!conversation) return json({ ok: false, error: "conversa não encontrada", terminal: true }, 404);
  const { data: channel, error: channelError } = await db.from("channels")
    .select("id,name,external_id,phone_number")
    .eq("id", conversation.channel_id).maybeSingle();
  if (channelError) return json({ ok: false, error: "falha ao consultar canal" }, 503);
  if (!channel || !canalAlvoFunil(channel, "5895")) {
    return json({ ok: false, error: "canal não é o WhatsApp 5895", terminal: true }, 422);
  }
  if (CONTROL_ACTIONS.has(body.request.action)) {
    const controlResult = await funilControl(new Request(
      `http://internal/funil-control?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: body.request.action,
          chatwoot_conversation_id: body.request.chatwoot_conversation_id,
          n8n_internal: true,
        }),
      },
    ));
    return controlResult;
  }
  if (
    isContactBlocked(conversation.contacts) ||
    isContactExcludedFromAutomation(conversation.contacts)
  ) return json({ ok: false, error: "contato bloqueado", terminal: true }, 422);

  const rows = await buildActionRows(body, String(conversation.id));
  const ids = rows.map((row) => row.id);
  const key = actionKey(body.request);
  const acceptedClaim = `n8n-action-accepted:${key}`;
  const { data: accepted, error: acceptedError } = await db.from("deliveries")
    .select("delivery_id").eq("delivery_id", acceptedClaim).maybeSingle();
  if (acceptedError) return json({ ok: false, error: "falha ao consultar confirmação" }, 503);
  if (accepted) return json({ ok: true, accepted: rows.length, duplicate: true });
  const sequenceId = body.request.action === "funil"
    ? await actionUuid(`${key}:sequence`)
    : null;
  if (sequenceId) {
    const { data: existing, error: existingError } = await db.from("sales_sequences")
      .select("id,status")
      .eq("conversation_id", conversation.id)
      .eq("funnel", RESTORED_5895_FUNNEL).maybeSingle();
    if (existingError) return json({ ok: false, error: "falha ao consultar sequência" }, 503);
    if (existing && existing.id !== sequenceId) {
      return json({ ok: true, accepted: 0, duplicate: true, sequence_status: existing.status });
    }
    if (!existing) {
      const { error: createError } = await db.from("sales_sequences").insert({
        id: sequenceId,
        conversation_id: conversation.id,
        chatwoot_conversation_id: body.request.chatwoot_conversation_id,
        funnel: RESTORED_5895_FUNNEL,
        current_day: 0,
        status: "paused",
      });
      if (createError && createError.code !== "23505") {
        return json({ ok: false, error: "falha ao reservar sequência" }, 503);
      }
      if (createError) {
        return json({ ok: false, error: "outra inscrição está em andamento" }, 409);
      }
    }
  }

  const { data: before, error: beforeError } = await db.from("scheduled_messages")
    .select("id").in("id", ids);
  if (beforeError) return json({ ok: false, error: "falha ao consultar peças" }, 503);
  const existed = (before ?? []).length === rows.length;
  const { error: insertError } = await db.from("scheduled_messages")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (insertError) return json({ ok: false, error: "falha ao gravar peças" }, 503);
  const { data: written, error: writtenError } = await db.from("scheduled_messages")
    .select("id").in("id", ids);
  if (writtenError || (written ?? []).length !== rows.length) {
    return json({ ok: false, error: "lote incompleto; envio mantido pausado" }, 503);
  }
  if (sequenceId) {
    const { error: sequenceError } = await db.from("sales_sequences")
      .update({ status: "running" }).eq("id", sequenceId).eq("status", "paused");
    if (sequenceError) return json({ ok: false, error: "falha ao ativar sequência" }, 503);
  }
  const { error: activateError } = await db.from("scheduled_messages")
    .update({ status: "pending" }).in("id", ids).eq("status", "paused");
  if (activateError) return json({ ok: false, error: "falha ao ativar peças" }, 503);
  try {
    await claimDelivery(db, acceptedClaim, "n8n-action-accepted");
  } catch {
    return json({ ok: false, error: "falha ao registrar confirmação" }, 503);
  }
  return json({ ok: true, accepted: rows.length, duplicate: existed });
}
