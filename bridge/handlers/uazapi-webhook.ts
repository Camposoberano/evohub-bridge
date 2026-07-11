// uazapi-webhook — recebe eventos do uazapi e grava em events (source=uazapi).
// Alimenta o monitor de eventos do painel e ingesta inbound de mensagens no Chatwoot.
// Auth: ?token=<UAZAPI_WEBHOOK_TOKEN|CHATWOOT_WEBHOOK_SECRET>.
import { admin, claimDelivery } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { type InboundAttachment, ingestInbound } from "../shared/inbound.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { instPost, listInstances, tokenForInstance } from "../shared/uazapi.ts";
import {
  isNutricaoIntent,
  isPlantioIntent,
  isPrecoIntent,
  isSaudacaoIntent,
  isVideoIntent,
  transcribeAudio,
} from "../shared/intent.ts";
import { autoEnrollFunil, enrollIfNew } from "./funil-enroll.ts";
import { autoPauseFunil } from "./funil-control.ts";
import {
  handleMenuClick,
  handleNutricaoClick,
  handlePlantioClick,
  handlePrecoClick,
} from "./hub-webhook.ts";

type Json = Record<string, unknown>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = optionalEnv("UAZAPI_WEBHOOK_TOKEN") ??
    env("CHATWOOT_WEBHOOK_SECRET");
  if (!timingSafeEqual(token, expected)) {
    return new Response("unauthorized", { status: 401 });
  }

  let p: Json;
  try {
    p = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const eventType = (p.event as string) ?? (p.type as string) ??
    (p.EventType as string) ?? "uazapi_event";
  const db = admin();
  db.from("events").insert({
    source: "uazapi",
    event_type: eventType,
    payload: p,
  }).then(() => {}, () => {});

  if (isInboundUazapiEvent(eventType, p)) {
    handleInbound(db, p).catch((e) =>
      console.error("uazapi-webhook handleInbound erro:", e)
    );
  }

  return new Response("ok", { status: 200 });
}

function isInboundUazapiEvent(eventType: string, p: Json): boolean {
  const data = (p.data ?? {}) as Json;
  if (eventType === "message.exchange") return true;
  if (eventType === "messages_update" || eventType === "ReadReceipt") return false;
  if (data.direction === "incoming") return true;
  if (Array.isArray(data.messages) && data.messages.length > 0) return true;
  if (data.message) return true;
  if (Array.isArray(p.messages) && p.messages.length > 0) return true;
  if (p.message) return true;
  return false;
}

async function handleInbound(db: ReturnType<typeof admin>, p: Json) {
  const data = (p.data && typeof p.data === "object") ? p.data as Json : p;
  const instanceName = firstString(
    (p.instanceData as Json | undefined)?.instance,
    p.instance,
    data.instance,
    data.instanceName,
    data.instance_id,
  );
  if (!instanceName) {
    console.warn("uazapi-webhook sem instance", p);
    return;
  }

  const channel = await findChannelForInstance(db, instanceName, data);
  if (!channel) {
    console.warn("uazapi-webhook sem canal para instancia", instanceName);
    return;
  }

  const messages = extractUazapiMessages(data);
  if (messages.length === 0) {
    console.warn("uazapi-webhook sem mensagens inbound", instanceName);
    return;
  }

  const acct = await accountForChannel(channel.id as string);
  const instanceToken = await tokenForInstance(instanceName);
  for (const rawMsg of messages) {
    const msg = await parseUazapiMessage(rawMsg, p, instanceToken ?? undefined);
    // Saida gerada pela API ja foi criada no Chatwoot pelo webhook de origem.
    // Saida digitada no aparelho precisa entrar como echo na conversa.
    if (msg.direction === "outgoing" && msg.wasSentByApi) continue;
    if (msg.isGroup) continue;
    if (!msg.from) {
      console.warn(
        "uazapi-webhook mensagem sem remetente",
        instanceName,
        msg.metaMessageId,
      );
      continue;
    }

    // Clique interativo precisa responder primeiro. A sincronização com Chatwoot
    // pode sofrer latência e não deve segurar uma ação de compra/novo tamanho.
    if (msg.direction === "incoming" && msg.menuClickId) {
      try {
        const clickClaimed = await claimDelivery(
          db,
          `uazapi-click-${channel.id}-${msg.metaMessageId ?? msg.menuClickId}`,
          "uazapi-click",
        );
        if (clickClaimed) {
          await handleUazapiClick(db, channel as Json, msg.from, msg.menuClickId, acct);
        }
      } catch (e) {
        console.error("uazapi-webhook click erro:", e);
      }
    }

    await ingestInbound(db, channel as Json, {
      from: msg.from,
      name: msg.name,
      metaMessageId: msg.metaMessageId,
      msgType: msg.msgType,
      content: msg.content,
      attachments: msg.attachments,
      sentAt: msg.sentAt,
      outgoing: msg.direction === "outgoing",
      acct,
    });

    if (msg.direction === "incoming") {
      try {
        await autoEnrollFunil(
          db,
          channel as Json,
          msg.from,
          msg.content,
          msg.fromAd,
        );
        if (isSaudacaoIntent(msg.content)) {
          await enrollIfNew(db, channel as Json, msg.from);
        }
      } catch (e) {
        console.error("uazapi-webhook auto-enroll erro:", e);
      }

      try {
        await handleUazapiIntent(db, channel as Json, msg, acct);
      } catch (e) {
        console.error("uazapi-webhook intent erro:", e);
      }
    }
  }
}

async function handleUazapiClick(
  db: ReturnType<typeof admin>,
  channel: Json,
  from: string,
  id: string,
  acct: Awaited<ReturnType<typeof accountForChannel>>,
): Promise<void> {
  if (id.startsWith("menu_")) {
    await handleMenuClick(db, channel, from, id, acct);
  } else if (id.startsWith("preco_") || id.startsWith("tam_") || id.startsWith("pag_")) {
    await handlePrecoClick(db, channel, from, id, acct);
  } else if (id.startsWith("plantio_")) {
    await handlePlantioClick(db, channel, from, id, acct);
  } else if (id.startsWith("nutricao_")) {
    await handleNutricaoClick(db, channel, from, id, acct);
  } else {
    console.warn("uazapi-webhook: clique sem handler", id);
    return;
  }
  console.log("uazapi-webhook: clique processado", id, from);
}

async function handleUazapiIntent(
  db: ReturnType<typeof admin>,
  channel: Json,
  msg: Awaited<ReturnType<typeof parseUazapiMessage>>,
  acct: Awaited<ReturnType<typeof accountForChannel>>,
): Promise<void> {
  if (!msg.from) return;
  const from = msg.from;
  let intentText = msg.content;
  if (isAudioType(msg.msgType) && msg.attachments?.length) {
    const audio = msg.attachments[0];
    const transcription = await transcribeAudio(audio.bytes, audio.contentType);
    if (!transcription) {
      console.warn("uazapi-webhook: áudio recebido, mas não foi transcrito", msg.metaMessageId);
      return;
    }
    intentText = transcription;
    console.log(
      "uazapi-webhook: áudio transcrito",
      msg.metaMessageId,
      JSON.stringify(transcription.slice(0, 160)),
    );
  }

  const intent = isPrecoIntent(intentText)
    ? { name: "preco", menu: "menu_preco" }
    : isVideoIntent(intentText)
    ? { name: "video", menu: "menu_depoimento" }
    : isPlantioIntent(intentText)
    ? { name: "plantio", menu: "menu_plantio" }
    : isNutricaoIntent(intentText)
    ? { name: "nutricao", menu: "menu_nutricao" }
    : null;
  if (!intent) return;

  const day = new Date().toISOString().slice(0, 10);
  const claimed = await claimDelivery(
    db,
    `intent-${intent.name}-${channel.id}-${from}-${day}`,
    "intent",
  );
  if (!claimed) return;

  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  if (contact) {
    const { data: conversation } = await db.from("conversations").select("id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if (conversation?.id) await autoPauseFunil(conversation.id as string);
  }

  await handleMenuClick(db, channel, from, intent.menu, acct);
  console.log("uazapi-webhook: intent disparado", intent.name, from);
}

async function findChannelForInstance(
  db: ReturnType<typeof admin>,
  instanceName: string,
  data: Json,
) {
  const normalizedInstanceName = instanceName.trim();
  const { data: byExternalId } = await db.from("channels").select("*").eq(
    "external_id",
    normalizedInstanceName,
  ).maybeSingle();
  if (byExternalId) return byExternalId;

  const { data: byName } = await db.from("channels").select("*").eq(
    "name",
    normalizedInstanceName,
  ).maybeSingle();
  if (byName) return byName;

  const chat = getJson(data, "chat");
  const sender = getJson(data, "sender");
  const waFastId = getString(chat, "wa_fastid") ?? getString(data, "wa_fastid");
  const waChatId = getString(chat, "wa_chatid") ?? getString(data, "wa_chatid");

  const instanceNumber = firstString(
    getString(data, "number"),
    getString(data, "phone"),
    getString(chat, "phone"),
    getString(chat, "wa_chatid"),
    getString(chat, "jid"),
    getString(data, "chatid"),
    getString(data, "chat_id"),
    getString(sender, "jid"),
    getString(sender, "lid"),
    getString(sender, "sender_pn"),
    getString(data, "owner"),
    waChatId,
    waFastId,
  );

  let targetDigits = instanceNumber ? normDigits(instanceNumber) : "";
  if (!targetDigits) {
    const instanceDigits = normDigits(normalizedInstanceName);
    if (instanceDigits.length >= 10) {
      targetDigits = instanceDigits;
    }
  }

  if (!targetDigits) {
    const inst = (await listInstances()).find((i) =>
      i.name === normalizedInstanceName || normDigits(i.name) === normDigits(normalizedInstanceName)
    );
    if (inst?.number) targetDigits = normDigits(inst.number);
  }

  if (!targetDigits) return null;

  const { data: channels } = await db.from("channels").select("*").eq(
    "type",
    "whatsapp",
  );
  const channelList = (channels ?? []) as Json[];
  return channelList.find((ch) => {
    const phoneDigits = normDigits(getString(ch, "phone_number") ?? "");
    const displayDigits = normDigits(getString(ch, "display_name") ?? "");
    const nameDigits = normDigits(getString(ch, "name") ?? "");
    const externalDigits = normDigits(getString(ch, "external_id") ?? "");
    return (
      phoneDigits === targetDigits ||
      displayDigits === targetDigits ||
      nameDigits === targetDigits ||
      externalDigits === targetDigits
    );
  }) ?? null;
}

function extractUazapiMessages(data: Json): Json[] {
  if (Array.isArray(data.messages) && data.messages.length > 0) {
    return data.messages as Json[];
  }
  if (data.message && typeof data.message === "object") {
    return [data.message as Json];
  }
  return [data];
}

async function parseUazapiMessage(
  message: Json,
  context: Json,
  instanceToken?: string,
) {
  const fromMe = isTruthy(
    message.fromMe,
    message.from_me,
    message.isFromMe,
    message.IsFromMe,
    getJson(message, "key")?.fromMe,
    getJson(context, "key")?.fromMe,
    getJson(context, "event")?.IsFromMe,
    getJson(context, "event")?.fromMe,
  );
  let fromRaw = firstString(
    getString(message, "sender_pn"),
    getString(getJson(message, "sender"), "sender_pn"),
    getString(context, "sender_pn"),
    getString(getJson(context, "sender"), "sender_pn"),
    message.from,
    getString(message, "sender"),
    getString(message, "sender_lid"),
    getString(context, "from"),
    getString(context, "sender"),
    getString(getJson(message, "sender"), "jid"),
    getString(getJson(context, "sender"), "jid"),
    getString(getJson(message, "chat"), "jid"),
    getString(getJson(context, "chat"), "jid"),
  );
  const wasSentByApi = isTruthy(
    message.wasSentByApi,
    message.was_sent_by_api,
    getJson(message, "metadata")?.wasSentByApi,
    getJson(context, "message")?.wasSentByApi,
  );
  if (fromMe) {
    // Em mensagens enviadas pelo aparelho, o remetente e o proprio numero;
    // para abrir a conversa correta precisamos usar o destinatario/chatid.
    fromRaw = firstString(
      getString(message, "recipient_pn"),
      getString(context, "recipient_pn"),
      getString(message, "to"),
      getString(message, "chatid"),
      getString(message, "chat_id"),
      getString(getJson(message, "chat"), "wa_chatid"),
      getString(getJson(message, "chat"), "jid"),
      getString(getJson(context, "chat"), "wa_chatid"),
      getString(getJson(context, "chat"), "jid"),
      getString(context, "chatid"),
      getString(getJson(context, "event"), "Chat"),
      fromRaw,
    );
  }
  const from = fromRaw ? fromRaw.replace(/@.*$/, "") : undefined;
  const name = firstString(
    getString(message, "name"),
    getString(message, "senderName"),
    getString(getJson(message, "sender"), "name"),
    getString(context, "name"),
    getString(getJson(context, "sender"), "name"),
  );
  const metaMessageId = firstString(
    getString(message, "id"),
    getString(message, "messageid"),
    getString(context, "id"),
    getString(context, "messageid"),
    getString(message, "message_id"),
    getString(context, "message_id"),
    getString(message, "uuid"),
    getString(context, "uuid"),
    getString(getJson(message, "key"), "id"),
    getString(getJson(context, "key"), "id"),
    getString(getJson(getJson(message, "message"), "key"), "id"),
    getString(getJson(getJson(context, "message"), "key"), "id"),
    getString(getJson(message, "message"), "id"),
    getString(getJson(context, "message"), "id"),
  );
  const downloadMessageId = firstString(
    getString(message, "messageid"),
    getString(context, "messageid"),
    getString(message, "message_id"),
    getString(context, "message_id"),
    metaMessageId?.split(":").pop(),
  );
  const sentAt = firstString(
    getString(message, "messageTimestamp"),
    getString(message, "timestamp"),
    getString(context, "timestamp"),
    getString(message, "ts"),
    getString(context, "ts"),
    getString(message, "createdAt"),
    getString(context, "createdAt"),
  );
  const direction = firstString(
    getString(message, "direction"),
    getString(context, "direction"),
  ) ?? (fromMe ? "outgoing" : "incoming");
  const messageContent = getJson(message, "content");
  const menuClickId = firstString(
    getString(message, "buttonOrListid"),
    getString(messageContent, "buttonOrListid"),
    getString(messageContent, "selectedRowID"),
    getString(getJson(messageContent, "singleSelectReply"), "selectedRowID"),
    getString(getJson(messageContent, "buttonReply"), "selectedButtonId"),
  );
  const msgType = firstString(
    getString(message, "mediaType"),
    getString(message, "messageType"),
    messageContent?.PTT === true ? "ptt" : undefined,
    getString(messageContent, "mimetype"),
    getString(getJson(message, "media"), "type"),
    getString(getJson(context, "media"), "type"),
    getString(message, "type"),
  ) ?? "text";

  const content = firstString(
    getString(message, "content"),
    getString(getJson(message, "content"), "text"),
    getString(getJson(message, "content"), "body"),
    getString(message, "text"),
    getString(message, "vote"),
    getString(context, "text"),
    getString(message, "body"),
    getString(context, "body"),
  ) ?? "";

  let attachments = await downloadUazapiAttachment(
    instanceToken,
    downloadMessageId,
    msgType,
  );
  // URLs de mídia do WhatsApp podem conter o arquivo ainda criptografado.
  // Quando temos credenciais para descriptografar, nunca persistimos esse fallback.
  const allowRawUrl = !instanceToken || !downloadMessageId;
  if (!attachments) {
    attachments = await buildUazapiAttachment(message, allowRawUrl);
  }
  if (!attachments) {
    attachments = await buildUazapiAttachment(context, allowRawUrl);
  }
  if (!attachments) {
    attachments = await buildUazapiAttachment(
      { content: getJson(message, "content"), type: msgType },
      allowRawUrl,
    );
  }

  return {
    from,
    name,
    metaMessageId,
    sentAt,
    direction,
    wasSentByApi,
    isGroup: Boolean(message.isGroup) || Boolean(getJson(context, "chat")?.wa_isGroup),
    msgType,
    content,
    attachments,
    fromAd: hasAdReferral(message, context),
    menuClickId,
  };
}

async function downloadUazapiAttachment(
  token: string | undefined,
  messageId: string | undefined,
  msgType: string,
): Promise<InboundAttachment[] | undefined> {
  if (!token || !messageId || !isMediaType(msgType)) return undefined;

  try {
    const result = await instPost("/message/download", token, {
      id: messageId,
      return_base64: true,
      return_link: false,
      generate_mp3: isAudioType(msgType),
    });
    if (!result.ok) {
      console.warn(
        "uazapi-webhook: download de mídia falhou",
        result.status,
        messageId,
      );
      return undefined;
    }

    const data = result.data as Json;
    const base64Value = firstString(data.base64Data, data.base64);
    if (!base64Value) {
      console.warn("uazapi-webhook: download sem base64", messageId);
      return undefined;
    }

    const base64 = base64Value.replace(/^data:[^;]+;base64,/, "");
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      console.warn("uazapi-webhook: mídia fora do limite", messageId, bytes.byteLength);
      return undefined;
    }

    const mimetype = firstString(data.mimetype) ??
      (isAudioType(msgType) ? "audio/mpeg" : "application/octet-stream");
    return [{
      filename: `${normalizedMediaType(msgType)}${extensionForMime(mimetype)}`,
      contentType: mimetype,
      bytes,
      sourceUrl: firstString(data.fileURL),
    }];
  } catch (e) {
    console.error("uazapi-webhook: erro ao descriptografar mídia", messageId, e);
    return undefined;
  }
}

async function buildUazapiAttachment(
  obj: Json,
  allowUrl = true,
): Promise<InboundAttachment[] | undefined> {
  const media = obj.media as Json | undefined;
  if (media) {
    const base64 = firstString(media.base64 as string | undefined);
    if (base64) {
      let bytes: Uint8Array;
      try {
        bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      } catch {
        return undefined;
      }
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return undefined;
      const mimetype = firstString(media.mimetype as string | undefined) ??
        "application/octet-stream";
      const filename = firstString(media.filename as string | undefined) ??
        `${firstString(media.type as string | undefined, obj.type as string | undefined) ?? "arquivo"}${extensionForMime(mimetype)}`;
      return [{
        filename,
        contentType: mimetype,
        bytes,
        sourceUrl: firstString(media.url as string | undefined),
      }];
    }
  }

  const content = getJson(obj, "content");
  if (content && allowUrl) {
    const url = firstString(content.URL as string | undefined, content.url as string | undefined);
    if (url) {
      const mimetype = firstString(content.mimetype as string | undefined) ??
        firstString(content.type as string | undefined) ?? "application/octet-stream";
      const filename = firstString(
        content.filename as string | undefined,
        content.fileName as string | undefined,
        firstString(content.type as string | undefined, obj.type as string | undefined) ?? "arquivo",
      ) + extensionForMime(mimetype);

      let bytes = new Uint8Array(0);
      try {
        const res = await fetch(url);
        if (res.ok) {
          const arrayBuffer = await res.arrayBuffer();
          bytes = new Uint8Array(arrayBuffer);
        } else {
          console.warn("buildUazapiAttachment: download falhou com status", res.status, url);
        }
      } catch (e) {
        console.error("buildUazapiAttachment: erro ao baixar", url, e);
      }

      return [{
        filename,
        contentType: mimetype,
        bytes,
        sourceUrl: url,
      }];
    }
  }

  return undefined;
}

function normalizedMediaType(msgType: string): string {
  const normalized = msgType.toLowerCase();
  if (isAudioType(normalized)) return "audio";
  if (normalized.includes("image")) return "imagem";
  if (normalized.includes("video")) return "video";
  if (normalized.includes("document")) return "documento";
  return "arquivo";
}

function isAudioType(msgType: string): boolean {
  const normalized = msgType.toLowerCase();
  return normalized.includes("audio") || normalized.includes("ptt");
}

function isMediaType(msgType: string): boolean {
  const normalized = msgType.toLowerCase();
  return ["audio", "ptt", "image", "video", "document", "sticker"]
    .some((type) => normalized.includes(type));
}

function hasAdReferral(message: Json, context: Json): boolean {
  if (
    getJson(message, "referral") ||
    getJson(context, "referral") ||
    getJson(getJson(message, "contextInfo"), "externalAdReply") ||
    getJson(getJson(context, "contextInfo"), "externalAdReply")
  ) return true;

  const sourceType = firstString(
    getString(message, "source_type"),
    getString(context, "source_type"),
    getString(getJson(message, "referral"), "source_type"),
    getString(getJson(context, "referral"), "source_type"),
  )?.toLowerCase();
  return sourceType === "ad" || sourceType === "ads";
}

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function getJson(obj: Json | undefined, key: string): Json | undefined {
  const value = obj?.[key];
  return typeof value === "object" && value !== null ? value as Json : undefined;
}

function getString(obj: Json | undefined, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isTruthy(...values: Array<unknown>): boolean {
  return values.some((value) =>
    value === true ||
    (typeof value === "string" && ["true", "1", "yes"].includes(value.trim().toLowerCase()))
  );
}

function normDigits(value: string | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/mp4" || mime === "video/mp4") return ".mp4";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "application/pdf") return ".pdf";
  return "";
}
