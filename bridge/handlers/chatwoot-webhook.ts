// chatwoot-webhook — recebe webhooks do Chatwoot.
//  * message_created (outgoing) -> envia ao cliente via EVO Hub /meta/*.
//  * demais eventos -> persistidos para analytics.
//
// Auth: o inbox é criado com webhook_url contendo ?token=<CHATWOOT_WEBHOOK_SECRET>.
// Validamos esse token. TODO Fase 5: usar assinatura nativa se a versão suportar.
import { admin, claimDelivery } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { sendMeta } from "../shared/hub.ts";
import { toVoiceOgg } from "../shared/audio.ts";
import { instPost, tokenForInstance } from "../shared/ryzeapi.ts";
import { windowState } from "../shared/window.ts";
import { createConversationMessage } from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { getHybridRoute, hybridSendText, hybridSendMedia } from "../shared/hybrid.ts";
import type { SendResult } from "../shared/hybrid.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

// instrumentação TEMPORÁRIA pra caçar a duplicação de áudio reportada (audio sai 2x, formatos
// diferentes, mesmo chatwoot_message_id) -- grava passo a passo em events, fire-and-forget,
// pra ler via REST sem precisar de acesso ao log do container. Remover depois de achar a causa.
function dbg(db: Db, cwMsgId: number | undefined, step: string, extra: Json) {
  db.from("events").insert({
    source: "debug-audio-dup",
    event_type: step,
    payload: { cwMsgId, t: Date.now(), ...extra },
  }).then(() => {}, () => {});
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  // canais ryzeapi usam o inbox webhook_url com o token deles (RYZEAPI_WEBHOOK_TOKEN) em vez
  // do segredo principal -- assim a inbox roteada pra ryzeapi não precisa expor o segredo
  // compartilhado dos canais oficiais.
  const validToken = timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET")) ||
    (optionalEnv("RYZEAPI_WEBHOOK_TOKEN") ? timingSafeEqual(token, optionalEnv("RYZEAPI_WEBHOOK_TOKEN")!) : false);
  if (!validToken) return new Response("unauthorized", { status: 401 });

  const raw = await req.text();
  let p: Json;
  try { p = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  const db = admin();
  const eventName = (p.event as string) ?? "unknown";

  db.from("events").insert({ source: "chatwoot", event_type: eventName, payload: p }).then(() => {}, () => {});

  // Envia em BACKGROUND e responde 200 na hora — senão o Chatwoot marca "Failed to send"
  // por timeout do webhook quando o envio (mídia/áudio) demora. O envio segue após o 200.
  if (eventName === "message_created" && isOutgoing(p) && !p.private) {
    handleOutgoing(db, p).catch((e) => console.error("chatwoot-webhook handleOutgoing erro:", e));
  }
  return new Response("ok", { status: 200 });
}

function isOutgoing(p: Json): boolean {
  const t = p.message_type;
  return t === "outgoing" || t === 1;
}

export async function handleOutgoing(db: Db, p: Json) {
  const conversation = (p.conversation ?? {}) as Json;
  const inbox = (p.inbox ?? {}) as Json;
  const cwConversationId = (conversation.id ?? p.conversation_id) as number | undefined;
  const cwInboxId = (inbox.id ?? p.inbox_id) as number | undefined;
  const content = (p.content as string) ?? "";
  const attachments = (p.attachments ?? []) as Json[];
  const attachment = attachments[0];

  const cwMsgId = p.id as number | undefined;
  let retryingFailedMessage: Json | null = null;
  await dbg(db, cwMsgId, "entry", { cwConversationId, cwInboxId, hasContent: !!content, attachmentsLen: attachments.length });

  if (!cwConversationId || (!content && !attachment)) { await dbg(db, cwMsgId, "early-return-no-content-no-attachment", {}); return; }

  // Anti-duplicata de LISTA/INTERATIVO: o n8n do funil manda a lista interativa ("Ver opções")
  // direto pela API do provedor e registra no Chatwoot como TEXTO no formato "<corpo> [op1 / op2
  // / ...]". Esse registro NÃO passa pela nossa tabela messages, então o pull-loop sync-chatwoot-out
  // lê e reenviaria como texto -> 2ª mensagem (colchetes) duplicada no WhatsApp. A lista real já
  // foi entregue; reenviar o registro como texto é sempre errado. Detecta o padrão e não reenvia.
  if (attachments.length === 0 && /\s\[[^\]]+\s\/\s[^\]]+\]\s*$/.test(content)) {
    await dbg(db, cwMsgId, "skip-list-interactive-registration-echo", { content: content.slice(0, 60) });
    return;
  }

  if (cwMsgId) {
    // 1) Claim ATÔMICO: 2 webhooks do mesmo message_created (retry/concorrência) -> só 1 envia.
    //    Evita o cliente receber a mensagem 2x (era a duplicação reportada).
    const claimed = await claimDelivery(db, `cw-out-${cwMsgId}`, "chatwoot");
    await dbg(db, cwMsgId, "claim-result", { claimed });
    if (!claimed) {
      console.log("cw msg já reivindicada — não reenvia", cwMsgId);
      return;
    }
    // 2) Anti-loop echo: mensagem já no banco (echo do aparelho que injetamos) -> não reenviar.
    const { data: dup } = await db.from("messages").select("id,status,direction,meta_message_id")
      .eq("chatwoot_message_id", cwMsgId).limit(1).maybeSingle();
    await dbg(db, cwMsgId, "anti-echo-check", { dupFound: !!dup, dupId: dup?.id ?? null, status: dup?.status ?? null });
    if (dup && dup.status !== "failed") { console.log("msg já ingerida (echo) — não reenvia", cwMsgId); return; }
    if (dup?.status === "failed") {
      retryingFailedMessage = dup as Json;
      await db.from("deliveries").delete().eq("delivery_id", `cw-out-${cwMsgId}`);
    }

    // 3) Segunda checagem DEFENSIVA depois de um delay: foi observado (sem causa raiz achada)
    // algum processo fora do nosso código inserindo uma linha pra esse mesmo chatwoot_message_id
    // poucos ms depois do claim, sem passar pelo claimDelivery. Espera um pouco e confere de
    // novo antes de mandar -- não resolve a causa, mas evita o cliente receber 2x.
    await new Promise((r) => setTimeout(r, 600));
    const { data: dupDelayed } = await db.from("messages").select("id,status").eq("chatwoot_message_id", cwMsgId).limit(1).maybeSingle();
    await dbg(db, cwMsgId, "anti-echo-check-delayed", { dupFound: !!dupDelayed, dupId: dupDelayed?.id ?? null });
    if (dupDelayed && dupDelayed.status !== "failed") { console.log("msg apareceu durante o delay defensivo — não reenvia", cwMsgId); return; }
  }

  const { data: channel } = await db.from("channels").select("*").eq("chatwoot_inbox_id", cwInboxId!).maybeSingle();
  if (!channel) { console.warn("sem canal p/ inbox", cwInboxId); return; }

  const { data: conv } = await db.from("conversations").select("*, contacts(*)")
    .eq("channel_id", channel.id).eq("chatwoot_conversation_id", cwConversationId).maybeSingle();
  const to = (conv?.contacts as Json)?.external_contact_id as string | undefined;
  if (!to) { console.warn("sem destinatário p/ conversa", cwConversationId); return; }

  // canal ryzeapi (whatsapp não-oficial): sem phone_number_id e com external_id (nome da instância).
  const isRyze = channel.type === "whatsapp" && Boolean(channel.external_id) && !channel.phone_number_id;

  // channel_token só existe pra canais OFICIAIS (Meta). Canal ryzeapi não tem linha em
  // channel_secrets -> .single() estoura (0 linhas) e secret!.channel_token dava TypeError,
  // matando o envio ANTES do branch ryzeapi (e deixando o claim cw-out-<id> travado).
  let token = "";
  if (!isRyze) {
    const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).single();
    token = secret!.channel_token;
  }

  // Envio por tipo de canal.
  let res: { ok: boolean; status: number; data: unknown } | undefined;
  let msgType = "text";
  let mediaUrl: string | null = null;
  if (isRyze) {
    // canal ryzeapi (whatsapp não-oficial): a ponte nativa deles não entrega SAÍDA de forma
    // confiável (bug achado testando, igual a entrada) -- manda direto pela API deles.
    const instance = channel.external_id as string;
    const rzToken = await tokenForInstance(instance);
    if (!rzToken) { console.warn("ryzeapi: instância não encontrada", instance); return; }
    if (attachments.length > 0) {
      for (const att of attachments) {
        const aUrl = (att.data_url as string) ?? null;
        if (!aUrl) { console.warn("anexo sem data_url", channel.id); continue; }
        const attachType = metaAttachmentType(att.file_type as string | undefined);
        msgType = attachType === "file" ? "document" : attachType;
        mediaUrl = aUrl;
        res = await instPost(`/message/media/${encodeURIComponent(instance)}`, rzToken, {
          number: to,
          mediaType: msgType,
          mediaUrl: aUrl,
          message: content || undefined,
          fileName: msgType === "document" ? ((att.fallback_title as string) ?? "arquivo") : undefined,
          isVoice: msgType === "audio",
        });
      }
    } else {
      res = await instPost(`/message/text/${encodeURIComponent(instance)}`, rzToken, { number: to, message: content });
      msgType = "text";
    }
  } else if (channel.type === "whatsapp") {
    if (!channel.phone_number_id) { console.warn("WA sem phone_number_id", channel.id); return; }
    const url = `${channel.phone_number_id}/messages`;
    const tplCmd = content.trim().match(/^\/(?:template|tpl|t)\s+([a-z0-9_]+)(?:\s+([a-z_]+))?$/i);

    // Rota híbrida: canal oficial com espelho uazapi → service msgs saem pelo não-oficial (R$0).
    // Templates e janela fechada sempre pela oficial. Se uazapi falhar → fallback automático.
    const hybrid = !tplCmd ? await getHybridRoute(channel.id as string, channel.phone_number_id as string, channel.phone_number as string) : null;

    if (!tplCmd && conv) {
      const win = await windowState(db, conv as Json, channel as Json);
      if (!win.aberta) {
        // Híbrido ignora janela Meta — uazapi não tem janela. Só bloqueia se não tem rota híbrida.
        if (!hybrid) {
          const acct = await accountForChannel(channel.id as string);
          const nota = `🚫 *JANELA ${win.tipo.toUpperCase()} FECHADA — mensagem NÃO enviada.*\n\n` +
            `"${content.slice(0, 120)}${content.length > 120 ? "…" : ""}"\n\n` +
            `O WhatsApp oficial só aceita mensagem livre até ${win.tipo} após a última mensagem do cliente. ` +
            `Opções: enviar template aprovado (digite /template <nome>) ou aguardar o cliente responder.`;
          try { await createConversationMessage(cwConversationId!, { content: nota, messageType: "outgoing", private: true }, acct); }
          catch (e) { console.warn("nota privada janela falhou:", String(e).slice(0, 120)); }
          await dbg(db, cwMsgId, "blocked-window-closed", { tipo: win.tipo });
          return;
        }
      }
    }
    if (tplCmd && attachments.length === 0) {
      const name = tplCmd[1];
      const lang = tplCmd[2] || "pt_BR";
      res = await sendMeta(token, url, {
        messaging_product: "whatsapp", to, type: "template",
        template: { name, language: { code: lang }, components: [] },
      });
      msgType = "template";
      if (!res.ok) console.error("template via chat falhou:", JSON.stringify((res.data as Json)?.error ?? res.data).slice(0, 200));
    } else if (attachments.length > 0) {
      const onlyAudio = attachments.every((att) =>
        metaAttachmentType(att.file_type as string | undefined) === "audio",
      );
      let captionUsed = false;
      for (const att of attachments) {
        const aUrl = (att.data_url as string) ?? null;
        if (!aUrl) { console.warn("anexo sem data_url", channel.id); continue; }
        const attachType = metaAttachmentType(att.file_type as string | undefined);
        msgType = attachType === "file" ? "document" : attachType;
        mediaUrl = aUrl;
        let linkUrl = aUrl;
        if (msgType === "audio") { const ogg = await toVoiceOgg(aUrl); if (ogg) { linkUrl = ogg; mediaUrl = ogg; } }

        // Híbrido: tenta uazapi primeiro
        let hybridRes: SendResult | null = null;
        if (hybrid) {
          hybridRes = await hybridSendMedia(hybrid, to, linkUrl, msgType, {
            caption: (content && !captionUsed && msgType !== "audio") ? content : undefined,
            fileName: msgType === "document" ? ((att.fallback_title as string) ?? "arquivo") : undefined,
            isVoice: msgType === "audio",
          });
          if (hybridRes) { captionUsed = captionUsed || (!!content && msgType !== "audio"); }
          await dbg(db, cwMsgId, "hybrid-media-attempt", { via: hybridRes?.via ?? "fallback", ok: hybridRes?.ok ?? false });
        }

        if (!hybridRes) {
          const mediaPayload: Json = { link: linkUrl };
          if (content && !captionUsed && msgType !== "audio") { mediaPayload.caption = content; captionUsed = true; }
          if (msgType === "document") mediaPayload.filename = (att.fallback_title as string) ?? "arquivo";
          await dbg(db, cwMsgId, "before-sendMeta-attachment", { msgType, linkUrl, attachmentsTotal: attachments.length });
          res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: msgType, [msgType]: mediaPayload });
          await dbg(db, cwMsgId, "after-sendMeta-attachment", { ok: res.ok, status: res.status });
        } else {
          res = hybridRes;
        }
      }
      if (content && !captionUsed && !onlyAudio) {
        if (hybrid) {
          const hr = await hybridSendText(hybrid, to, content);
          if (hr) { res = hr; } else {
            res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: "text", text: { body: content } });
          }
        } else {
          res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: "text", text: { body: content } });
        }
        msgType = "text";
      }
    } else {
      // Texto puro
      if (hybrid) {
        const hr = await hybridSendText(hybrid, to, content);
        if (hr) { res = hr; } else {
          res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: "text", text: { body: content } });
        }
        await dbg(db, cwMsgId, "hybrid-text-attempt", { via: (hr ? "uazapi" : "fallback") });
      } else {
        res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: "text", text: { body: content } });
      }
    }
  } else if (to.startsWith("cmt-fb-") || to.startsWith("cmt-ig-")) {
    // Fase 2: responder COMENTÁRIO no FB/IG (Graph API /{comment-id}/replies).
    // O contato de comentário tem external_contact_id = "cmt-fb-<uid>" / "cmt-ig-<username>".
    // Pra responder, precisamos do comment_id mais recente da conversa (meta_message_id da última msg inbound).
    if (!content) { console.warn("reply comment sem texto — anexos não suportados em comments"); return; }
    const { data: lastInbound } = await db.from("messages")
      .select("meta_message_id")
      .eq("conversation_id", conv?.id)
      .eq("direction", "in")
      .not("meta_message_id", "is", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const commentId = lastInbound?.meta_message_id as string | undefined;
    if (!commentId) { console.warn("reply comment: sem comment_id inbound na conversa", cwConversationId); return; }
    await dbg(db, cwMsgId, "comment-reply-attempt", { commentId, to });
    res = await sendMeta(token, `${commentId}/replies`, { message: content });
    await dbg(db, cwMsgId, "comment-reply-result", { ok: res.ok, status: res.status, data: JSON.stringify(res.data).slice(0, 200) });
    msgType = "text";
  } else {
    // facebook / instagram (Messenger): texto e anexo são mensagens separadas (não há caption).
    for (const att of attachments) {
      const aUrl = (att.data_url as string) ?? null;
      if (!aUrl) { console.warn("anexo sem data_url", channel.id); continue; }
      const attachType = metaAttachmentType(att.file_type as string | undefined);
      msgType = attachType === "file" ? "document" : attachType;
      mediaUrl = aUrl;
      res = await sendMeta(token, "me/messages", {
        recipient: { id: to },
        message: { attachment: { type: attachType, payload: { url: aUrl, is_reusable: true } } },
        messaging_type: "RESPONSE",
      });
    }
    if (content) {
      res = await sendMeta(token, "me/messages", {
        recipient: { id: to }, message: { text: content }, messaging_type: "RESPONSE",
      });
      if (attachments.length === 0) msgType = "text";
    }
  }

  if (!res) { console.warn("nada enviado (sem conteúdo/anexo válido)", channel.id); await dbg(db, cwMsgId, "no-res-nothing-sent", {}); return; }
  console.log("chatwoot-out result:", JSON.stringify({
    cwMsgId,
    channel: channel.name,
    ok: res.ok,
    status: res.status,
    via: (res as Json).via ?? "official",
    data: JSON.stringify(res.data).slice(0, 300),
  }));
  const d = res.data as Json | null;
  const messages = d && Array.isArray((d as { messages?: unknown }).messages)
    ? (d as { messages: Json[] }).messages
    : undefined;
  const extractedMessageId = messages?.length
    ? ((messages[0] as Json)?.id as string | undefined) ?? null
    : null;
  const extractedDataMessageId = d && typeof (d as { data?: unknown }).data === "object" && d.data !== null
    ? (typeof ((d.data as Json).messageId) === "string" ? ((d.data as Json).messageId as string) : null)
    : null;
  const metaId = extractedMessageId ??
    (d && typeof (d as { message_id?: unknown }).message_id === "string" ? (d as { message_id: string }).message_id : null) ??
    extractedDataMessageId ??
    (d && typeof (d as { id?: unknown }).id === "string" ? (d as { id: string }).id : null);

  await dbg(db, cwMsgId, "before-insert-messages", { msgType, mediaUrl, metaId });
  const messageRow = {
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: msgType,
    content,
    media_url: mediaUrl,
    meta_message_id: metaId,
    chatwoot_message_id: (p.id as number) ?? null,
    status: res.ok ? "sent" : "failed",
  };
  if (retryingFailedMessage?.id) {
    await db.from("messages").update(messageRow).eq("id", retryingFailedMessage.id);
  } else {
    await db.from("messages").insert(messageRow);
  }

  if (conv && !conv.first_response_at) {
    await db.from("conversations").update({ first_response_at: new Date().toISOString() }).eq("id", conv.id);
  }
}

// Mapeia file_type do Chatwoot pro tipo de attachment da Messenger Send API.
function metaAttachmentType(fileType?: string): "image" | "audio" | "video" | "file" {
  if (fileType === "image" || fileType === "audio" || fileType === "video") return fileType;
  return "file";
}
