// chatwoot-webhook — recebe webhooks do Chatwoot.
//  * message_created (outgoing) -> envia ao cliente via EVO Hub /meta/*.
//  * demais eventos -> persistidos para analytics.
//
// Auth: o inbox é criado com webhook_url contendo ?token=<CHATWOOT_WEBHOOK_SECRET>.
// Validamos esse token. TODO Fase 5: usar assinatura nativa se a versão suportar.
import { admin, claimDelivery } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { sendMeta } from "../shared/hub.ts";
import { toVoiceOgg } from "../shared/audio.ts";

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
  if (!timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET"))) {
    return new Response("unauthorized", { status: 401 });
  }

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

async function handleOutgoing(db: Db, p: Json) {
  const conversation = (p.conversation ?? {}) as Json;
  const inbox = (p.inbox ?? {}) as Json;
  const cwConversationId = (conversation.id ?? p.conversation_id) as number | undefined;
  const cwInboxId = (inbox.id ?? p.inbox_id) as number | undefined;
  const content = (p.content as string) ?? "";
  const attachments = (p.attachments ?? []) as Json[];
  const attachment = attachments[0];

  const cwMsgId = p.id as number | undefined;
  await dbg(db, cwMsgId, "entry", { cwConversationId, cwInboxId, hasContent: !!content, attachmentsLen: attachments.length });

  if (!cwConversationId || (!content && !attachment)) { await dbg(db, cwMsgId, "early-return-no-content-no-attachment", {}); return; }

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
    const { data: dup } = await db.from("messages").select("id").eq("chatwoot_message_id", cwMsgId).limit(1).maybeSingle();
    await dbg(db, cwMsgId, "anti-echo-check", { dupFound: !!dup, dupId: dup?.id ?? null });
    if (dup) { console.log("msg já ingerida (echo) — não reenvia", cwMsgId); return; }
  }

  const { data: channel } = await db.from("channels").select("*").eq("chatwoot_inbox_id", cwInboxId!).maybeSingle();
  if (!channel) { console.warn("sem canal p/ inbox", cwInboxId); return; }

  const { data: conv } = await db.from("conversations").select("*, contacts(*)")
    .eq("channel_id", channel.id).eq("chatwoot_conversation_id", cwConversationId).maybeSingle();
  const to = (conv?.contacts as Json)?.external_contact_id as string | undefined;
  if (!to) { console.warn("sem destinatário p/ conversa", cwConversationId); return; }

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).single();
  const token = secret!.channel_token;

  // Envio por tipo de canal.
  let res;
  let msgType = "text";
  let mediaUrl: string | null = null;
  if (channel.type === "whatsapp") {
    if (!channel.phone_number_id) { console.warn("WA sem phone_number_id", channel.id); return; }
    const url = `${channel.phone_number_id}/messages`;
    // Disparo de template DE DENTRO DO CHAT: agente digita "/template <nome> [idioma]" (ou /tpl, /t).
    // Útil pra falar com cliente fora da janela 24h sem sair do Chatwoot.
    const tplCmd = content.trim().match(/^\/(?:template|tpl|t)\s+([a-z0-9_]+)(?:\s+([a-z_]+))?$/i);
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
      // mídia (com ou sem legenda). A legenda do Chatwoot (content) entra na 1ª mídia.
      // Bug antigo: "if (content) só texto" descartava a mídia quando havia legenda.
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
        // áudio: transcodifica pra ogg/opus pra virar "voz gravada" (PTT) no WhatsApp.
        let linkUrl = aUrl;
        if (msgType === "audio") { const ogg = await toVoiceOgg(aUrl); if (ogg) { linkUrl = ogg; mediaUrl = ogg; } }
        const mediaPayload: Json = { link: linkUrl };
        // áudio NÃO aceita caption; image/video/document aceitam.
        if (content && !captionUsed && msgType !== "audio") { mediaPayload.caption = content; captionUsed = true; }
        if (msgType === "document") mediaPayload.filename = (att.fallback_title as string) ?? "arquivo";
        await dbg(db, cwMsgId, "before-sendMeta-attachment", { msgType, linkUrl, attachmentsTotal: attachments.length });
        res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: msgType, [msgType]: mediaPayload });
        await dbg(db, cwMsgId, "after-sendMeta-attachment", { ok: res.ok, status: res.status });
      }
      // legenda que não coube na mídia → texto separado. Áudio puro NÃO manda texto extra
      // (Chatwoot costuma preencher content com placeholder tipo "áudio").
      if (content && !captionUsed && !onlyAudio) {
        res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: "text", text: { body: content } });
        msgType = "text";
      }
    } else {
      res = await sendMeta(token, url, { messaging_product: "whatsapp", to, type: "text", text: { body: content } });
    }
  } else {
    // facebook / instagram (Messenger): texto e anexo são mensagens separadas (não há caption).
    // Manda cada anexo e, se houver texto, manda também — antes só ia um dos dois.
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
  const d = res.data as Json;
  const metaId = (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ??
    ((d?.message_id as string) ?? null);

  await dbg(db, cwMsgId, "before-insert-messages", { msgType, mediaUrl, metaId });
  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: msgType,
    content,
    media_url: mediaUrl,
    meta_message_id: metaId,
    chatwoot_message_id: (p.id as number) ?? null,
    status: res.ok ? "sent" : "failed",
  });

  if (conv && !conv.first_response_at) {
    await db.from("conversations").update({ first_response_at: new Date().toISOString() }).eq("id", conv.id);
  }
}

// Mapeia file_type do Chatwoot pro tipo de attachment da Messenger Send API.
function metaAttachmentType(fileType?: string): "image" | "audio" | "video" | "file" {
  if (fileType === "image" || fileType === "audio" || fileType === "video") return fileType;
  return "file";
}
