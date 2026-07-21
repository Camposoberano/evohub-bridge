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
import { toSocialMp3, toVoiceOgg } from "../shared/audio.ts";
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

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Json;
  const cwConvId = Number(body.chatwoot_conversation_id);
  if (!cwConvId) {
    return json({ error: "chatwoot_conversation_id obrigatório" }, 400);
  }

  // compat: content direto = texto
  const type = (body.type as string) ?? "text";
  const payload = (body.payload as Json) ??
    (body.content ? { content: body.content } : {});
  const dedupeScope = body.dedupe_scope as string | undefined;

  const db = admin();
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

  const isWhatsapp = channel.type === "whatsapp";
  const isSocialComment = to.startsWith("cmt-fb-") || to.startsWith("cmt-ig-");
  if (!isWhatsapp && isSocialComment) {
    return json({
      error:
        "funil disponível apenas em conversa privada do Facebook/Instagram",
      blocked: "comentario-publico",
    }, 422);
  }
  if (isWhatsapp && !channel.phone_number_id) {
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
  if (!channelToken && !hybrid) return json({ error: "canal sem token" }, 404);
  const acct = await accountForChannel(channel.id as string);

  // GATE de janela (Meta): funil/n8n mandando mensagem livre com janela fechada = rejeição
  // silenciosa e custo perdido. Bloqueia e deixa NOTA PRIVADA na conversa (1x/dia por conversa,
  // pra retry do cron não virar spam de nota).
  if (isWhatsapp && !hybrid) {
    const win = await windowState(db, conv as Json, channel as Json);
    if (!win.aberta) {
      const dia = new Date().toISOString().slice(0, 10);
      if (await claimDelivery(db, `wnote-${cwConvId}-${dia}`, "window-note")) {
        const nota =
          `🚫 *JANELA ${win.tipo.toUpperCase()} FECHADA — envio automático (funil/campanha) bloqueado.*\n\n` +
          `As próximas peças NÃO serão entregues até o cliente responder. ` +
          `Opções: template aprovado (/template <nome>) ou aguardar resposta do cliente.`;
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
        payload: { conv: cwConvId, type, janela: win.tipo },
      }).then(() => {}, () => {});
      return json({ ok: false, blocked: "janela-fechada", janela: win.tipo });
    }
  }

  // Anti-dup: n8n cron pode chamar send-outbound 2x pra mesma scheduled_message se o envio
  // demora mais que o intervalo do cron (60s). Claim atômico por conteúdo+conversa (2min TTL).
  const claimKey = outboundClaimKey(cwConvId, type, payload, dedupeScope);
  if (!await claimDeliveryWithTtl(db, claimKey, "send-outbound", 2 * 60_000)) {
    console.log("send-outbound: claim dup bloqueado", claimKey.slice(0, 80));
    return json({ ok: true, deduplicated: true });
  }

  // text_sequence: várias mensagens de texto com pausa real entre elas (efeito "digitando").
  // Cron de 1min não separa peças com gap < 60s -> o pacing tem que ser feito aqui dentro,
  // numa chamada só, em vez de depender do agendamento de cada peça.
  if (type === "text_sequence") {
    const texts = (payload.texts as string[] | undefined)?.filter((t) =>
      t?.trim()
    ) ?? [];
    const delayMs = (payload.delay_ms as number | undefined) ?? 3500;
    if (texts.length === 0) return json({ error: "texts obrigatório" }, 400);

    const results: Json[] = [];
    for (let i = 0; i < texts.length; i++) {
      const content = texts[i];
      let res: { ok: boolean; status: number; data: unknown };
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
      const d = res.data as Json;
      const metaId =
        (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ??
          ((d?.message_id as string) ?? null);

      let cwMsgId: number | undefined;
      try {
        cwMsgId = (await createConversationMessage(cwConvId, {
          content,
          messageType: "outgoing",
        }, acct))?.id;
      } catch (e) {
        console.warn(
          "send-outbound: registro Chatwoot falhou (entrega ok):",
          String(e).slice(0, 150),
        );
      }

      await db.from("messages").insert({
        conversation_id: conv.id,
        channel_id: channel.id,
        direction: "out",
        msg_type: "text",
        content,
        meta_message_id: metaId,
        chatwoot_message_id: cwMsgId ?? null,
        status: res.ok ? "sent" : "failed",
      });
      results.push({ ok: res.ok, meta_message_id: metaId });
      if (!res.ok) {
        console.error(
          "send-outbound (text_sequence) falhou:",
          JSON.stringify(d).slice(0, 250),
        );
        // rejeição fica consultável (Meta recusa em silêncio; Chatwoot mostra "sent" mesmo assim).
        db.from("events").insert({
          source: "funil",
          event_type: "send_failed",
          payload: {
            conv: cwConvId,
            type: "text_sequence",
            status: res.status,
            error: (d as Json)?.error ?? d,
          },
        }).then(() => {}, () => {});
      }
      if (i < texts.length - 1) await sleep(delayMs);
    }
    return json({ ok: results.every((r) => r.ok), results });
  }

  // monta o payload Meta conforme o tipo (interactive/áudio/vídeo só fazem sentido no WhatsApp)
  let metaBody: Json | null = null;
  let registroTexto = "";
  if (type === "text") {
    const content = (payload.content as string) ?? "";
    if (!content.trim()) return json({ error: "content vazio" }, 400);
    metaBody = { type: "text", text: { body: content } };
    registroTexto = content;
  } else if (type === "image" || type === "video") {
    const link = payload.media_url as string;
    const caption = payload.caption as string | undefined;
    if (!link) return json({ error: "media_url obrigatório" }, 400);
    metaBody = { type, [type]: caption ? { link, caption } : { link } };
    registroTexto = caption ?? `[${type}]`;
  } else if (type === "audio") {
    const src = payload.media_url as string;
    if (!src) return json({ error: "media_url obrigatório" }, 400);
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
    const buttons = (payload.buttons as { id: string; title: string }[]) ?? [];
    if (!text || buttons.length === 0) {
      return json({ error: "text e buttons obrigatórios" }, 400);
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
    registroTexto = text + " [" + buttons.map((b) => b.title).join(" / ") + "]";
  } else if (type === "list") {
    const text = (payload.text as string) ?? "";
    const buttonLabel = (payload.button_label as string) ?? "Ver opções";
    const sections = (payload.sections as {
      title?: string;
      rows: { id: string; title: string; description?: string }[];
    }[]) ?? [];
    if (!text || sections.length === 0) {
      return json({ error: "text e sections obrigatórios" }, 400);
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
    return json({ error: "tipo desconhecido: " + type }, 400);
  }

  let res: { ok: boolean; status: number; data: unknown } | undefined;

  if (hybrid) {
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
    else console.log("send-outbound hybrid:", type, "fallback oficial");
  }

  // Se a rota híbrida falhou, a Meta só pode ser usada como fallback enquanto a
  // janela oficial estiver aberta. Fora dela, devolve bloqueio para liberar o
  // claim da macro e permitir uma nova tentativa depois.
  if (!res && isWhatsapp && hybrid) {
    const win = await windowState(db, conv as Json, channel as Json);
    if (!win.aberta) {
      await db.from("events").insert({
        source: "hybrid",
        event_type: "fallback_blocked_window",
        channel_id: channel.id,
        payload: { conv: cwConvId, type, janela: win.tipo },
      });
      return json({
        ok: false,
        blocked: "rota-hibrida-indisponivel-e-janela-fechada",
        janela: win.tipo,
      });
    }
  }

  if (!res && !isWhatsapp) {
    let socialPayload = payload;
    let instagramAudioUrl: string | null = null;
    if (type === "audio" && channel.type === "instagram") {
      instagramAudioUrl = await toSocialMp3(String(payload.media_url ?? ""));
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
      return json(
        { error: `conteúdo ${type} inválido para canal social` },
        400,
      );
    }
    for (const item of socialMessages) {
      const itemResult = await sendMeta(channelToken!, "me/messages", {
        recipient: { id: to },
        message: item.message,
        messaging_type: "RESPONSE",
      });
      res = itemResult;
      if (!itemResult.ok) break;
    }
    if (!res?.ok && type === "audio" && channel.type === "instagram") {
      const audioUrl = instagramAudioUrl ?? String(payload.media_url ?? "");
      const fallbackText = `🎧 Ouça o áudio desta etapa:\n${audioUrl}`;
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
    res = await sendMeta(channelToken!, `${channel.phone_number_id}/messages`, {
      messaging_product: "whatsapp",
      to,
      ...metaBody,
    });
  }

  const d = res.data as Json;
  const metaId =
    (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ??
      ((d?.message_id as string) ?? null);

  // registra no Chatwoot pro atendente ver (não re-dispara webhook).
  let cwMsgId: number | undefined;
  try {
    const cwMsg = await createConversationMessage(cwConvId, {
      content: registroTexto,
      messageType: "outgoing",
    }, acct);
    cwMsgId = cwMsg?.id;
  } catch (e) {
    console.warn(
      "send-outbound: registro Chatwoot falhou (entrega ok):",
      String(e).slice(0, 150),
    );
  }

  await db.from("messages").insert({
    conversation_id: conv.id,
    channel_id: channel.id,
    direction: "out",
    msg_type: type === "interactive" ? "interactive" : type,
    content: registroTexto,
    media_url: (payload.media_url as string) ?? null,
    meta_message_id: metaId,
    chatwoot_message_id: cwMsgId ?? null,
    status: res.ok ? "sent" : "failed",
  });

  if (!res.ok) {
    console.error("send-outbound falhou:", JSON.stringify(d).slice(0, 250));
    // rejeição fica consultável em events (Meta recusa em silêncio -- ex: janela 24h fechada;
    // Chatwoot mostra "sent" mesmo assim). select * from events where source='funil'.
    db.from("events").insert({
      source: "funil",
      event_type: "send_failed",
      payload: {
        conv: cwConvId,
        type,
        status: res.status,
        error: (d as Json)?.error ?? d,
      },
    }).then(() => {}, () => {});
  }
  return json({
    ok: res.ok,
    meta_message_id: metaId,
    status: res.status,
    error: res.ok ? undefined : (d as Json)?.error,
  });
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
