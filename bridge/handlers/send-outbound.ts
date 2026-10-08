// send-outbound — disparo proativo controlado (n8n/funil de apresentação). O n8n NÃO cria
// mensagem direto no Chatwoot porque mensagem criada via API REST do Chatwoot NÃO dispara o
// webhook de inbox -> o bridge nunca entregaria. Então o n8n chama AQUI: este endpoint
// (1) entrega no WhatsApp pelo canal certo e (2) registra no Chatwoot pro atendente ver
// (registro via API não re-dispara webhook -> sem loop).
//
// Tipos: text | text_sequence | image | audio | video | interactive (botões) | list.
// Body: { chatwoot_conversation_id, type, payload }
//   text          -> { content }
//   text_sequence -> { texts:[...], delay_ms? } -- várias msgs com pausa real entre elas
//                     (efeito "digitando"; cron de 1min não separa peças com gap curto)
//   image/video   -> { media_url, caption? }
//   audio         -> { media_url }
//   interactive   -> { text, buttons:[{id,title}], header_image? } -- título do botão
//                     máx 20 caracteres (limite da Meta), senão a msg INTEIRA é rejeitada.
//   list          -> { text, button_label?, sections:[{title?, rows:[{id,title,description?}]}] }
//                     FB/IG não suportam list -> cai pra texto simples (fallback automático).
// Compat: { chatwoot_conversation_id, content } sem type vira text.
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { confereSegredo } from "../shared/segredo-bridge.ts";
import {
  admin,
  claimDelivery,
  claimDeliveryWithTtl,
} from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { windowState } from "../shared/window.ts";
import { sendMeta, uploadMetaMedia } from "../shared/hub.ts";
import { createConversationMessage } from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { toSocialAudio, toVoiceOgg } from "../shared/audio.ts";
import {
  decidirSemMidia,
  midiaDisponivel,
  urlDaPeca,
} from "../shared/midia-funil.ts";
import {
  getHybridRoute,
  hybridSendMedia,
  hybridSendMenu,
  hybridSendText,
  isHybridRecipient,
} from "../shared/hybrid.ts";
import { buildHybridMenuFallback } from "../shared/hybrid-menu.ts";
import { renderSocialFunnelMessages } from "../shared/social-funnel.ts";
import { outboundClaimKey } from "../shared/outbound-dedup.ts";
import { normalizeMsgType } from "../shared/msg-type.ts";
import {
  isWithinFunnelSendHours,
  nextFunnelSendAt,
} from "../shared/business-hours.ts";
import {
  deliveryMetadata,
  type FunnelDeliveryEvent,
  type FunnelDeliveryMetadata,
  type FunnelDeliveryOutcome,
  MAX_AUTOMATIC_DELIVERY_RETRIES,
  nextFunnelRetryAt,
  payloadWithoutDeliveryMetadata,
  persistFunnelDeliveryState,
  providerDiagnostic,
  recordFunnelDeliveryEvent,
} from "../shared/funnel-delivery.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (
    !confereSegredo(token, [env("CHATWOOT_WEBHOOK_SECRET")], "send-outbound")
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Json;
  const cwConvId = Number(body.chatwoot_conversation_id);
  if (!cwConvId) {
    return json({ error: "chatwoot_conversation_id obrigatório" }, 400);
  }

  // compat: content direto = texto
  // `let` porque o tipo e o payload vêm da linha agendada quando há scheduled_message_id.
  let type = (body.type as string) ?? "text";
  let payload = (body.payload as Json) ??
    (body.content ? { content: body.content } : {});
  const dedupeScope = body.dedupe_scope as string | undefined;
  // Elo com a fila do funil (bridge/shared/funnel-queue.ts) -- ausente em chamada manual/n8n
  // avulsa, presente quando send-outbound é acionado por scheduled_messages.
  const funnelLink = {
    funnel: (body.funnel as string | undefined) ?? null,
    funnel_day: typeof body.funnel_day === "number" ? body.funnel_day : null,
    funnel_step: (body.funnel_step as string | undefined) ?? null,
    scheduled_message_id: (body.scheduled_message_id as string | undefined) ??
      null,
  };

  const db = admin();
  let scheduledRow: Json | null = null;
  let scheduledPayload: Json = payload;
  let deliveryState: FunnelDeliveryMetadata | null = null;
  if (funnelLink.scheduled_message_id) {
    const { data, error } = await db.from("scheduled_messages")
      .select(
        "id,status,conversation_id,chatwoot_conversation_id,funnel,day,step,type,payload,send_at",
      )
      .eq("id", funnelLink.scheduled_message_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return json({
        ok: false,
        sent: false,
        blocked: "scheduled-message-not-found",
      }, 404);
    }
    scheduledRow = data as Json;
    if (scheduledRow.status === "sent") {
      return json({
        ok: true,
        sent: true,
        already_sent: true,
        deduplicated: true,
      });
    }
    if (scheduledRow.status !== "pending") {
      return json({
        ok: false,
        sent: false,
        blocked: "scheduled-message-not-pending",
        status: scheduledRow.status,
      }, 409);
    }
    if (
      Number(scheduledRow.chatwoot_conversation_id) !== cwConvId ||
      (funnelLink.funnel && scheduledRow.funnel !== funnelLink.funnel)
    ) {
      return json({
        ok: false,
        sent: false,
        blocked: "scheduled-message-mismatch",
      }, 409);
    }
    const scheduledAt = Date.parse(String(scheduledRow.send_at ?? ""));
    if (Number.isFinite(scheduledAt) && scheduledAt > Date.now()) {
      return json({
        ok: false,
        sent: false,
        blocked: "scheduled-message-not-due",
        not_due: true,
        send_at: scheduledRow.send_at,
      }, 409);
    }
    const { data: sentClaim, error: sentClaimError } = await db
      .from("deliveries").select("delivery_id")
      .eq("delivery_id", "funnel-sent-" + funnelLink.scheduled_message_id)
      .maybeSingle();
    if (sentClaimError) throw sentClaimError;
    if (sentClaim) {
      const sentAt = new Date().toISOString();
      await db.from("scheduled_messages").update({
        status: "sent",
        sent_at: sentAt,
      }).eq("id", funnelLink.scheduled_message_id);
      await db.from("sales_sequences").update({
        current_day: Number(scheduledRow.day ?? 0),
        last_sent_at: sentAt,
      }).eq("conversation_id", scheduledRow.conversation_id)
        .eq("funnel", scheduledRow.funnel)
        .in("status", ["running", "paused"]);
      return json({
        ok: true,
        sent: true,
        already_sent: true,
        deduplicated: true,
      });
    }
    scheduledPayload =
      scheduledRow.payload && typeof scheduledRow.payload === "object"
        ? scheduledRow.payload as Json
        : {};
    const currentSequenceId = String(
      scheduledPayload.__funnel_sequence_id ?? "",
    );
    const currentStep = Number(scheduledRow.step ?? 0);
    const { data: previousSteps, error: previousError } = await db
      .from("scheduled_messages")
      .select("id,status,step,payload")
      .eq("conversation_id", scheduledRow.conversation_id)
      .eq("funnel", scheduledRow.funnel)
      .lt("step", currentStep)
      .order("step", { ascending: true })
      .limit(100);
    if (previousError) throw previousError;
    const previousUnsent = (previousSteps ?? []).find((item: Json) => {
      const previousPayload = item.payload && typeof item.payload === "object"
        ? item.payload as Json
        : {};
      const sameExecution = !currentSequenceId ||
        previousPayload.__funnel_sequence_id === currentSequenceId;
      return sameExecution && item.status !== "sent" &&
        item.status !== "cancelled";
    }) as Json | undefined;
    if (previousUnsent) {
      return json({
        ok: false,
        sent: false,
        blocked: "previous-step-not-sent",
        previous_step: previousUnsent.step,
        previous_status: previousUnsent.status,
      }, 409);
    }
    deliveryState = deliveryMetadata(scheduledPayload);
    type = String(scheduledRow.type ?? type);
    funnelLink.funnel = String(scheduledRow.funnel ?? funnelLink.funnel ?? "");
    funnelLink.funnel_day = Number(
      scheduledRow.day ?? funnelLink.funnel_day ?? 0,
    );
    funnelLink.funnel_step = type;
    payload = payloadWithoutDeliveryMetadata(scheduledPayload);
  }
  // Última barreira para toda peça ligada a scheduled_messages, incluindo chamadas
  // do n8n que não passam pelo pump local. Mensagens manuais continuam fora desta regra.
  if (funnelLink.scheduled_message_id && !isWithinFunnelSendHours()) {
    const nextSendAt = new Date(nextFunnelSendAt()).toISOString();
    const { data: deferred, error: deferError } = await db
      .from("scheduled_messages")
      .update({ send_at: nextSendAt })
      .eq("id", funnelLink.scheduled_message_id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (deferError) {
      console.error(
        "send-outbound: falha ao reagendar fora da janela:",
        deferError,
      );
      return json({
        ok: false,
        deferred_business_window: true,
        error: "não foi possível reagendar fora da janela",
      }, 503);
    }
    if (!deferred) {
      return json({
        ok: false,
        error: "scheduled_message não está pendente",
        deferred_business_window: true,
        next_send_at: nextSendAt,
      }, 409);
    }
    console.log(
      `send-outbound: scheduled_message ${funnelLink.scheduled_message_id} ` +
        `adiada para ${nextSendAt} por horário de envio`,
    );
    return json({
      ok: false,
      deferred_business_window: true,
      next_send_at: nextSendAt,
    }, 409);
  }
  const { data: conv } = await db.from("conversations").select(
    "*, contacts(*), channels(*)",
  )
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (!conv) {
    return json({ error: "conversa não encontrada p/ " + cwConvId }, 404);
  }
  const channel = conv.channels as Json;
  const to = (conv.contacts as Json)?.external_contact_id as string | undefined;
  if (!channel || !to) {
    return json({ error: "canal ou destinatário ausente" }, 404);
  }

  let attemptNumber = deliveryState?.attempts ?? 0;
  let attemptId: string | null = null;
  let dispatchStarted = false;
  let acceptedProviderMessages = 0;
  const deliveryEventBase = ():
    | Omit<
      FunnelDeliveryEvent,
      | "outcome"
      | "http_status"
      | "provider_code"
      | "provider_subcode"
      | "provider_error_type"
      | "retryable"
      | "retry_at"
      | "failure_stage"
      | "partial"
    >
    | null => {
    if (!funnelLink.scheduled_message_id || !scheduledRow) return null;
    return {
      scheduled_message_id: funnelLink.scheduled_message_id,
      conversation_id: String(scheduledRow.conversation_id ?? conv.id),
      funnel: String(scheduledRow.funnel ?? funnelLink.funnel ?? ""),
      day: Number.isFinite(Number(scheduledRow.day))
        ? Number(scheduledRow.day)
        : null,
      step: Number.isFinite(Number(scheduledRow.step))
        ? Number(scheduledRow.step)
        : null,
      type: String(scheduledRow.type ?? type),
      channel_type: String(channel.type ?? ""),
      attempt_id: attemptId,
      attempt_number: attemptNumber,
    };
  };
  const writeDeliveryOutcome = async (
    outcome: FunnelDeliveryOutcome,
    status: "pending" | "sent" | "failed",
    details: Partial<FunnelDeliveryEvent> = {},
    retryAt?: string,
  ): Promise<boolean> => {
    const eventBase = deliveryEventBase();
    if (!eventBase || !scheduledRow || !deliveryState) return true;
    if (
      status === "sent" &&
      funnelLink.scheduled_message_id
    ) {
      await claimDelivery(
        db,
        "funnel-sent-" + funnelLink.scheduled_message_id,
        "funnel-delivery-success",
      );
    }
    const nextState: FunnelDeliveryMetadata = {
      ...deliveryState,
      last_outcome: outcome,
      retry_at: retryAt,
    };
    if (typeof details.http_status === "number") {
      nextState.provider_status = details.http_status;
    }
    if (
      typeof details.provider_code === "number" ||
      typeof details.provider_code === "string"
    ) nextState.provider_code = details.provider_code;
    let persisted = true;
    try {
      await persistFunnelDeliveryState(
        db,
        funnelLink.scheduled_message_id!,
        scheduledPayload,
        nextState,
        status,
        status === "sent" ? new Date().toISOString() : undefined,
        retryAt,
      );
    } catch {
      persisted = false;
    }
    deliveryState = nextState;
    await recordFunnelDeliveryEvent(db, String(channel.id ?? ""), {
      ...eventBase,
      ...details,
      outcome,
      retry_at: retryAt ?? null,
    });
    return persisted;
  };
  const beginDeliveryAttempt = async (): Promise<boolean> => {
    if (!scheduledRow || !funnelLink.scheduled_message_id || !deliveryState) {
      return true;
    }
    attemptNumber = deliveryState.attempts + 1;
    attemptId = crypto.randomUUID();
    deliveryState = {
      ...deliveryState,
      attempts: attemptNumber,
      attempt_id: attemptId,
      last_attempt_at: new Date().toISOString(),
      last_outcome: "started",
      retry_at: undefined,
    };
    try {
      await persistFunnelDeliveryState(
        db,
        funnelLink.scheduled_message_id,
        scheduledPayload,
        deliveryState,
        "pending",
      );
    } catch {
      return false;
    }
    const eventBase = deliveryEventBase();
    if (eventBase) {
      await recordFunnelDeliveryEvent(db, String(channel.id ?? ""), {
        ...eventBase,
        outcome: "started",
      });
    }
    return true;
  };
  const advanceFunnelSequence = async (sentAt: string): Promise<void> => {
    if (!scheduledRow) return;
    try {
      const { error } = await db.from("sales_sequences").update({
        current_day: Number(scheduledRow.day ?? 0),
        last_sent_at: sentAt,
      }).eq("conversation_id", scheduledRow.conversation_id)
        .eq("funnel", scheduledRow.funnel)
        .in("status", ["running", "paused"]);
      if (error) throw error;
    } catch (error) {
      console.error("send-outbound: avanço da sequência falhou", error);
      await recordFunnelDeliveryEvent(db, String(channel.id ?? ""), {
        ...(deliveryEventBase() ?? {
          scheduled_message_id: funnelLink.scheduled_message_id ?? "",
        }),
        outcome: "sent",
        failure_stage: "sequence_advance",
      });
    }
  };

  if (scheduledRow && deliveryState?.last_outcome === "started") {
    const lastAttemptAt = Date.parse(deliveryState.last_attempt_at ?? "");
    if (
      !Number.isFinite(lastAttemptAt) ||
      Date.now() - lastAttemptAt >= 10 * 60_000
    ) {
      await writeDeliveryOutcome("uncertain", "failed", {
        failure_stage: "stale_attempt_recovery",
        retryable: false,
      });
      return json({
        ok: false,
        sent: false,
        blocked: "envio-incerto",
        uncertain: true,
      }, 409);
    }
    return json({
      ok: false,
      sent: false,
      blocked: "envio-em-andamento",
      in_progress: true,
    }, 409);
  }
  const isWhatsapp = channel.type === "whatsapp";
  const isSocialComment = to.startsWith("cmt-fb-") || to.startsWith("cmt-ig-");
  if (!isWhatsapp && isSocialComment) {
    await writeDeliveryOutcome("rejected", "failed", {
      failure_stage: "unsupported_channel",
      retryable: false,
    });
    return json({
      error:
        "funil disponível apenas em conversa privada do Facebook/Instagram",
      blocked: "comentario-publico",
    }, 422);
  }
  if (isWhatsapp && !channel.phone_number_id) {
    await writeDeliveryOutcome("rejected", "failed", {
      failure_stage: "missing_phone_number_id",
      retryable: false,
    });
    return json({
      error: "WhatsApp sem phone_number_id (uazapi não suportado aqui)",
    }, 422);
  }

  const hybridCandidate = isWhatsapp
    ? await getHybridRoute(
      channel.id as string,
      channel.phone_number_id as string,
      channel.phone_number as string,
    )
    : null;
  const hybrid = hybridCandidate && isHybridRecipient(to)
    ? hybridCandidate
    : null;

  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const channelToken = secret?.channel_token as string | undefined;
  if (!channelToken && !hybrid) {
    await writeDeliveryOutcome("rejected", "failed", {
      failure_stage: "missing_channel_token",
      retryable: false,
    });
    return json({
      ok: false,
      sent: false,
      blocked: "canal-sem-token",
    }, 404);
  }
  const acct = await accountForChannel(channel.id as string);

  // GATE de janela (Meta): funil/n8n mandando mensagem livre com janela fechada = rejeição
  // silenciosa e custo perdido. Bloqueia e deixa NOTA PRIVADA na conversa (1x/dia por conversa,
  // pra retry do cron não virar spam de nota). Vale pra DM oficial de qualquer produto Meta —
  // WhatsApp Cloud, Messenger e Instagram; quem decide se há janela é windowState (comentário
  // público não tem janela e já foi barrado acima).
  if (!hybrid) {
    const win = await windowState(db, conv as Json, channel as Json);
    if (!win.aberta) {
      const dia = new Date().toISOString().slice(0, 10);
      if (await claimDelivery(db, `wnote-${cwConvId}-${dia}`, "window-note")) {
        const nota =
          `🚫 *JANELA ${win.tipo.toUpperCase()} FECHADA — envio automático (funil/campanha) bloqueado.*\n\n` +
          `As próximas peças NÃO serão entregues até o cliente responder. ` +
          // Messenger e Instagram não têm template aprovado: a janela só reabre pelo cliente.
          (isWhatsapp
            ? `Opções: template aprovado (/template <nome>) ou aguardar resposta do cliente.`
            : `Este canal não tem template — a janela só reabre quando o cliente mandar uma nova mensagem.`);
        try {
          await createConversationMessage(cwConvId, {
            content: nota,
            messageType: "outgoing",
            private: true,
          }, acct);
        } catch (e) {
          console.warn("nota privada janela falhou:", String(e).slice(0, 120));
        }
      }
      db.from("events").insert({
        source: "funil",
        event_type: "send_blocked_window",
        channel_id: channel.id,
        payload: {
          conv: cwConvId,
          type,
          janela: win.tipo,
          canal: channel.type,
        },
      }).then(() => {}, () => {});
      return json({
        ok: false,
        blocked: "janela-fechada",
        awaiting_window: true,
        janela: win.tipo,
      });
    }
  }

  // Anti-dup: n8n cron pode chamar send-outbound 2x pra mesma scheduled_message se o envio
  // demora mais que o intervalo do cron (60s). Claim atômico por conteúdo+conversa (2min TTL).
  const claimKey = outboundClaimKey(cwConvId, type, payload, dedupeScope);
  const { data: uncertainClaim, error: uncertainClaimError } = await db.from(
    "deliveries",
  )
    .select("delivery_id").eq("delivery_id", `uncertain-${claimKey}`)
    .maybeSingle();
  if (uncertainClaimError) throw uncertainClaimError;
  if (uncertainClaim) {
    await writeDeliveryOutcome("uncertain", "failed", {
      failure_stage: "existing_uncertain_claim",
      retryable: false,
    });
    return json({
      ok: false,
      sent: false,
      blocked: "envio-incerto",
      uncertain: true,
    }, 409);
  }
  if (!await claimDeliveryWithTtl(db, claimKey, "send-outbound", 2 * 60_000)) {
    console.log("send-outbound: claim dup bloqueado", claimKey.slice(0, 80));
    if (funnelLink.scheduled_message_id) {
      const { data: current, error: currentError } = await db
        .from("scheduled_messages").select("status")
        .eq("id", funnelLink.scheduled_message_id).maybeSingle();
      if (currentError) throw currentError;
      if (current?.status === "sent") {
        return json({
          ok: true,
          sent: true,
          already_sent: true,
          deduplicated: true,
        });
      }
    }
    return json({
      ok: false,
      sent: false,
      blocked: "envio-em-andamento",
      in_progress: true,
    }, 409);
  }

  try {
    // text_sequence: várias mensagens de texto com pausa real entre elas (efeito "digitando").
    // Cron de 1min não separa peças com gap < 60s -> o pacing tem que ser feito aqui dentro,
    // numa chamada só, em vez de depender do agendamento de cada peça.
    if (type === "text_sequence") {
      const texts = (payload.texts as string[] | undefined)?.filter((t) =>
        t?.trim()
      ) ?? [];
      const delayMs = (payload.delay_ms as number | undefined) ?? 3500;
      if (texts.length === 0) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
          error: "texts obrigatório",
        }, 400);
      }
      if (!await beginDeliveryAttempt()) {
        return json({
          ok: false,
          sent: false,
          blocked: "attempt-state-persistence-failed",
        }, 503);
      }

      const results: Json[] = [];
      let lastResponse: { ok: boolean; status: number; data: unknown } | null =
        null;
      for (let i = 0; i < texts.length; i++) {
        const content = texts[i];
        let res: { ok: boolean; status: number; data: unknown };
        dispatchStarted = true;
        const hr = hybrid ? await hybridSendText(hybrid, to, content) : null;
        if (hr) {
          res = hr;
        } else {
          const path = isWhatsapp
            ? `${channel.phone_number_id}/messages`
            : "me/messages";
          const metaPayload = isWhatsapp
            ? {
              messaging_product: "whatsapp",
              to,
              type: "text",
              text: { body: content },
            }
            : {
              recipient: { id: to },
              message: { text: content },
              messaging_type: "RESPONSE",
            };
          res = await sendMeta(channelToken!, path, metaPayload);
        }
        lastResponse = res;
        if (res.ok) acceptedProviderMessages++;
        const d = res.data as Json;
        const metaId =
          (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ??
            ((d?.message_id as string) ?? null);

        let cwMsgId: number | undefined;
        try {
          cwMsgId = (await createConversationMessage(cwConvId, {
            content,
            messageType: "outgoing",
            alreadySent: true,
          }, acct))?.id;
        } catch (e) {
          console.warn(
            "send-outbound: registro Chatwoot falhou (entrega ok):",
            String(e).slice(0, 150),
          );
        }

        try {
          const { error: messageError } = await db.from("messages").insert({
            conversation_id: conv.id,
            channel_id: channel.id,
            direction: "out",
            msg_type: "text",
            content,
            meta_message_id: metaId,
            chatwoot_message_id: cwMsgId ?? null,
            status: res.ok ? "sent" : "failed",
            ...funnelLink,
          });
          if (messageError) {
            console.error(
              "send-outbound: registro da mensagem falhou",
              messageError,
            );
          }
        } catch (messageError) {
          console.error(
            "send-outbound: exceção ao registrar mensagem",
            messageError,
          );
        }
        results.push({ ok: res.ok, meta_message_id: metaId });
        if (!res.ok) {
          console.error(
            "send-outbound (text_sequence) falhou:",
            JSON.stringify(d).slice(0, 250),
          );
          db.from("events").insert({
            source: "funil",
            event_type: "send_failed",
            payload: {
              conv: cwConvId,
              scheduled_message_id: funnelLink.scheduled_message_id,
              type: "text_sequence",
              status: res.status,
              error: (d as Json)?.error ?? d,
            },
          }).then(() => {}, () => {});
          break;
        }
        if (i < texts.length - 1) await sleep(delayMs);
      }
      const sequenceSent = results.length === texts.length &&
        results.every((r) => r.ok === true);
      if (sequenceSent) {
        await writeDeliveryOutcome("sent", "sent");
        await advanceFunnelSequence(new Date().toISOString());
        return json({ ok: true, sent: true, results });
      }
      const failedResponse = lastResponse;
      const diagnostic = providerDiagnostic(failedResponse?.data);
      const details: Partial<FunnelDeliveryEvent> = {
        http_status: failedResponse?.status ?? null,
        provider_code: diagnostic.code,
        provider_subcode: diagnostic.subcode,
        provider_error_type: diagnostic.type,
        partial: acceptedProviderMessages > 0,
      };
      if (
        failedResponse?.status === 429 &&
        acceptedProviderMessages === 0 &&
        attemptNumber > 0 &&
        attemptNumber <= MAX_AUTOMATIC_DELIVERY_RETRIES
      ) {
        const retryAt = nextFunnelRetryAt(attemptNumber);
        details.retryable = true;
        const persisted = await writeDeliveryOutcome(
          "retry_scheduled",
          "pending",
          details,
          retryAt,
        );
        return json({
          ok: false,
          sent: false,
          retry_scheduled: persisted,
          retry_at: persisted ? retryAt : undefined,
          status: failedResponse.status,
          results,
        }, 503);
      }
      const uncertain = acceptedProviderMessages > 0 ||
        failedResponse?.status === 408 ||
        (failedResponse?.status ?? 0) >= 500;
      const outcome: FunnelDeliveryOutcome = acceptedProviderMessages > 0
        ? "partial"
        : uncertain
        ? "uncertain"
        : "rejected";
      details.retryable = false;
      await writeDeliveryOutcome(outcome, "failed", details);
      return json({
        ok: false,
        sent: false,
        blocked: uncertain ? "envio-incerto" : "provedor-rejeitou-envio",
        uncertain,
        status: failedResponse?.status,
        results,
      }, 502);
    }

    // A mídia faz parte da etapa. Sem ela, não enviar legenda isolada nem avançar o funil.
    const urlPeca = urlDaPeca(type, payload);
    if (urlPeca && !(await midiaDisponivel(urlPeca))) {
      const mediaKey = decodeURIComponent(
        urlPeca.split("?")[0].split("/").pop() ?? "",
      );
      if (!scheduledRow) {
        const decision = decidirSemMidia(type, payload);
        db.from("events").insert({
          source: "funil",
          event_type: "midia_indisponivel",
          channel_id: channel.id,
          payload: {
            type,
            media_key: mediaKey.slice(0, 160),
            action: decision?.acao ?? "segue",
          },
        }).then(() => {}, () => {});
        if (decision?.acao === "pular") {
          return json({ ok: true, skipped: "midia-indisponivel" });
        }
        if (decision?.acao === "texto") {
          type = "text";
          payload = { content: decision.conteudo };
        }
        if (decision?.acao === "sem-header") {
          payload = { ...payload, header_image: undefined };
        }
      } else {
        await writeDeliveryOutcome("media_unavailable", "failed", {
          failure_stage: "media_preflight",
          media_key: mediaKey.slice(0, 160),
          retryable: false,
        });
        console.warn(
          "send-outbound: mídia do funil indisponível:",
          mediaKey.slice(0, 80),
        );
        return json({
          ok: false,
          sent: false,
          blocked: "midia-indisponivel",
          failure_stage: "media_preflight",
        }, 422);
      }
    }

    // monta o payload Meta conforme o tipo (interactive/áudio/vídeo só fazem sentido no WhatsApp)
    let metaBody: Json | null = null;
    let registroTexto = "";
    if (type === "text") {
      const content = (payload.content as string) ?? "";
      if (!content.trim()) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
          error: "content vazio",
        }, 400);
      }
      metaBody = { type: "text", text: { body: content } };
      registroTexto = content;
    } else if (type === "image" || type === "video") {
      const link = payload.media_url as string;
      const caption = payload.caption as string | undefined;
      if (!link) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
          error: "media_url obrigatório",
        }, 400);
      }
      metaBody = { type, [type]: caption ? { link, caption } : { link } };
      registroTexto = caption ?? `[${type}]`;
    } else if (type === "audio") {
      const src = payload.media_url as string;
      if (!src) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
          error: "media_url obrigatório",
        }, 400);
      }
      // VOZ gravada (PTT): transcodifica pra ogg/opus E envia por MEDIA_ID (não link). Áudio por
      // link o WhatsApp mostra como ARQUIVO; só bytes subidos por media_id viram bolha de voz.
      // Fallback pro link se transcode/upload falhar (pelo menos o áudio toca).
      const oggUrl = isWhatsapp ? await toVoiceOgg(src) : null;
      let audioObj: Json = { link: oggUrl ?? src };
      if (oggUrl && channel.phone_number_id && channelToken) {
        try {
          const ob = await fetch(oggUrl);
          if (ob.ok) {
            const bytes = new Uint8Array(await ob.arrayBuffer());
            const up = await uploadMetaMedia(
              channelToken!,
              channel.phone_number_id as string,
              bytes,
              "audio/ogg",
              "voz.ogg",
            );
            if (up.ok && up.id) audioObj = { id: up.id };
            else {
              console.warn(
                "send-outbound: uploadMetaMedia falhou, usa link:",
                up.status,
                JSON.stringify(up.data).slice(0, 150),
              );
            }
          }
        } catch (e) {
          console.warn(
            "send-outbound: media_id erro, usa link:",
            String(e).slice(0, 120),
          );
        }
      }
      metaBody = { type: "audio", audio: audioObj }; // áudio não aceita caption
      registroTexto = "[áudio]";
    } else if (type === "interactive") {
      const text = (payload.text as string) ?? "";
      const buttons = (payload.buttons as { id: string; title: string }[]) ??
        [];
      if (!text || buttons.length === 0) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
          error: "text e buttons obrigatórios",
        }, 400);
      }
      const interactive: Json = {
        type: "button",
        body: { text },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title },
          })),
        },
      };
      if (payload.header_image) {
        interactive.header = {
          type: "image",
          image: { link: payload.header_image },
        };
      }
      metaBody = { type: "interactive", interactive };
      registroTexto = text + " [" + buttons.map((b) => b.title).join(" / ") +
        "]";
    } else if (type === "list") {
      const text = (payload.text as string) ?? "";
      const buttonLabel = (payload.button_label as string) ?? "Ver opções";
      const sections = (payload.sections as {
        title?: string;
        rows: { id: string; title: string; description?: string }[];
      }[]) ?? [];
      if (!text || sections.length === 0) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
          error: "text e sections obrigatórios",
        }, 400);
      }
      metaBody = {
        type: "interactive",
        interactive: {
          type: "list",
          body: { text },
          action: { button: buttonLabel, sections },
        },
      };
      const allRows = sections.flatMap((s) => s.rows);
      registroTexto = isWhatsapp
        ? text + " [" + allRows.map((r) => r.title).join(" / ") + "]"
        : `${text}\n[${allRows.length} opções enviadas como botões]`;
    } else {
      await writeDeliveryOutcome("rejected", "failed", {
        failure_stage: "invalid_payload",
        retryable: false,
      });
      return json({
        ok: false,
        sent: false,
        blocked: "invalid-payload",
        error: "tipo desconhecido: " + type,
      }, 400);
    }

    let res: { ok: boolean; status: number; data: unknown } | undefined;
    if (!await beginDeliveryAttempt()) {
      return json({
        ok: false,
        sent: false,
        blocked: "attempt-state-persistence-failed",
      }, 503);
    }

    if (hybrid) {
      dispatchStarted = true;
      if (type === "text") {
        const content = (payload.content as string) ?? "";
        res = (await hybridSendText(hybrid, to, content)) ?? undefined;
      } else if (type === "audio") {
        const src = payload.media_url as string;
        const oggUrl = await toVoiceOgg(src);
        res = (await hybridSendMedia(hybrid, to, oggUrl ?? src, "audio", {
          isVoice: true,
        })) ?? undefined;
      } else if (type === "image" || type === "video") {
        const link = payload.media_url as string;
        res = (await hybridSendMedia(hybrid, to, link, type, {
          caption: payload.caption as string | undefined,
        })) ?? undefined;
      } else if (type === "interactive") {
        const buttons = (payload.buttons as { id: string; title: string }[]) ??
          [];
        res = (await hybridSendMenu(
          hybrid,
          to,
          payload.text as string,
          buttons,
          payload.header_image as string | undefined,
        )) ?? undefined;
        if (!res) {
          res = (await hybridSendText(
            hybrid,
            to,
            buildHybridMenuFallback(payload.text as string, buttons),
          )) ?? undefined;
        }
      }
      if (res) console.log("send-outbound hybrid:", type, "uazapi OK");
      else {
        console.log("send-outbound hybrid:", type, "fallback oficial");
        dispatchStarted = false;
      }
    }

    // Se a rota híbrida falhou, a Meta só pode ser usada como fallback enquanto a
    // janela oficial estiver aberta. Fora dela, devolve bloqueio para liberar o
    // claim da macro e permitir uma nova tentativa depois.
    if (!res && isWhatsapp && hybrid) {
      const win = await windowState(db, conv as Json, channel as Json);
      if (!win.aberta) {
        await writeDeliveryOutcome("blocked", "pending", {
          failure_stage: "hybrid_fallback_window",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "rota-hibrida-indisponivel-e-janela-fechada",
          janela: win.tipo,
        });
      }
    }

    if (!res && !isWhatsapp) {
      let socialPayload = payload;
      let instagramAudioUrl: string | null = null;
      // Vale para Facebook TAMBÉM, não só Instagram: o ogg do funil falhava nos dois. No
      // Instagram derrubava 100% dos áudios para o fallback de link; no Facebook falhava de
      // forma intermitente, o que é pior de perceber.
      if (
        type === "audio" &&
        (channel.type === "instagram" || channel.type === "facebook")
      ) {
        instagramAudioUrl = await toSocialAudio(
          String(payload.media_url ?? ""),
        );
        if (instagramAudioUrl) {
          socialPayload = { ...payload, media_url: instagramAudioUrl };
        }
      }
      const socialMessages = renderSocialFunnelMessages(
        type,
        socialPayload,
        channel.type as "facebook" | "instagram",
      );
      if (socialMessages.length === 0) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "invalid_social_payload",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "invalid-payload",
        }, 400);
      }
      for (const item of socialMessages) {
        dispatchStarted = true;
        const itemResult = await sendMeta(channelToken!, "me/messages", {
          recipient: { id: to },
          message: item.message,
          messaging_type: "RESPONSE",
        });
        res = itemResult;
        if (itemResult.ok) acceptedProviderMessages++;
        if (!itemResult.ok) break;
      }
      if (
        !res?.ok &&
        type === "audio" &&
        channel.type === "instagram" &&
        !scheduledRow
      ) {
        const audioUrl = instagramAudioUrl ?? String(payload.media_url ?? "");
        const fallbackText = `🎧 Ouça o áudio desta etapa:\n${audioUrl}`;
        dispatchStarted = true;
        res = await sendMeta(channelToken!, "me/messages", {
          recipient: { id: to },
          message: { text: fallbackText },
          messaging_type: "RESPONSE",
        });
        if (res.ok) {
          registroTexto = "[áudio enviado por link no Instagram]";
          db.from("events").insert({
            source: "social-audio",
            event_type: "instagram_audio_link_fallback",
            channel_id: channel.id,
            payload: {
              conversation_id: conv.id,
              chatwoot_conversation_id: cwConvId,
            },
          }).then(() => {}, () => {});
        }
      }
    }

    if (!res) {
      dispatchStarted = true;
      res = await sendMeta(
        channelToken!,
        `${channel.phone_number_id}/messages`,
        {
          messaging_product: "whatsapp",
          to,
          ...metaBody,
        },
      );
    }

    if (res.ok && acceptedProviderMessages === 0) acceptedProviderMessages++;
    const d = res.data as Json;
    const metaId =
      (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ??
        ((d?.message_id as string) ?? null);

    if (res.ok) {
      const sentAt = new Date().toISOString();
      await writeDeliveryOutcome("sent", "sent");
      await advanceFunnelSequence(sentAt);
    }

    // registra no Chatwoot pro atendente ver (não re-dispara webhook).
    let cwMsgId: number | undefined;
    try {
      const cwMsg = await createConversationMessage(cwConvId, {
        content: registroTexto,
        messageType: "outgoing",
        alreadySent: true,
      }, acct);
      cwMsgId = cwMsg?.id;
    } catch (e) {
      console.warn(
        "send-outbound: registro Chatwoot falhou (entrega ok):",
        String(e).slice(0, 150),
      );
    }

    try {
      const { error: messageError } = await db.from("messages").insert({
        conversation_id: conv.id,
        channel_id: channel.id,
        direction: "out",
        // normalizeMsgType porque "list" (send-outbound aceita como tipo) não é valor do enum
        // msg_type -- sem isso o insert falhava/virava "unknown" pra esse tipo de envio.
        msg_type: normalizeMsgType(type),
        content: registroTexto,
        media_url: (payload.media_url as string) ?? null,
        meta_message_id: metaId,
        chatwoot_message_id: cwMsgId ?? null,
        status: res.ok ? "sent" : "failed",
        ...funnelLink,
      });
      if (messageError) {
        console.error(
          "send-outbound: registro da mensagem falhou",
          messageError,
        );
      }
    } catch (messageError) {
      console.error(
        "send-outbound: exceção ao registrar mensagem",
        messageError,
      );
    }

    if (!res.ok) {
      const diagnostic = providerDiagnostic(d);
      console.error(
        "send-outbound falhou:",
        res.status,
        diagnostic.code ?? "sem código do provedor",
      );
      const details: Partial<FunnelDeliveryEvent> = {
        http_status: res.status,
        provider_code: diagnostic.code,
        provider_subcode: diagnostic.subcode,
        provider_error_type: diagnostic.type,
        retryable: res.status === 429,
        partial: acceptedProviderMessages > 0,
      };
      if (
        res.status === 429 &&
        acceptedProviderMessages === 0 &&
        attemptNumber > 0 &&
        attemptNumber <= MAX_AUTOMATIC_DELIVERY_RETRIES
      ) {
        const retryAt = nextFunnelRetryAt(attemptNumber);
        const persisted = await writeDeliveryOutcome(
          "retry_scheduled",
          "pending",
          details,
          retryAt,
        );
        return json({
          ok: false,
          sent: false,
          retry_scheduled: persisted,
          retry_at: persisted ? retryAt : undefined,
          status: res.status,
        }, 503);
      }
      const uncertain = acceptedProviderMessages > 0 ||
        res.status === 408 || res.status >= 500;
      if (uncertain) {
        await claimDelivery(
          db,
          "uncertain-" + claimKey,
          "send-outbound-uncertain",
        );
      }
      const outcome: FunnelDeliveryOutcome = acceptedProviderMessages > 0
        ? "partial"
        : uncertain
        ? "uncertain"
        : "rejected";
      await writeDeliveryOutcome(outcome, "failed", details);
      return json({
        ok: false,
        sent: false,
        blocked: uncertain ? "envio-incerto" : "provedor-rejeitou-envio",
        uncertain,
        status: res.status,
        provider_code: diagnostic.code,
      }, uncertain ? 502 : 422);
    }
    return json({
      ok: true,
      sent: true,
      meta_message_id: metaId,
      status: res.status,
    });
  } catch (error) {
    const uncertainByTransport = error instanceof Error &&
      error.name === "UncertainDeliveryError";
    if (!dispatchStarted && !uncertainByTransport) {
      if (scheduledRow) {
        await writeDeliveryOutcome("rejected", "failed", {
          failure_stage: "send_preparation",
          retryable: false,
        });
        return json({
          ok: false,
          sent: false,
          blocked: "send-preparation-failed",
        }, 500);
      }
      throw error;
    }
    if (
      acceptedProviderMessages > 0 || dispatchStarted || uncertainByTransport
    ) {
      const outcome: FunnelDeliveryOutcome = acceptedProviderMessages > 0
        ? "partial"
        : "uncertain";
      await claimDelivery(
        db,
        "uncertain-" + claimKey,
        "send-outbound-uncertain",
      );
      await writeDeliveryOutcome(outcome, "failed", {
        failure_stage: "provider_transport",
        retryable: false,
        partial: acceptedProviderMessages > 0,
      });
      db.from("events").insert({
        source: "funil",
        event_type: "send_uncertain",
        channel_id: channel.id,
        payload: {
          scheduled_message_id: funnelLink.scheduled_message_id,
          funnel: funnelLink.funnel,
          day: funnelLink.funnel_day,
          type,
          outcome,
        },
      }).then(() => {}, () => {});
      return json({
        ok: false,
        sent: false,
        blocked: acceptedProviderMessages > 0
          ? "envio-parcial-incerto"
          : "envio-incerto",
        uncertain: true,
      }, 502);
    }
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
