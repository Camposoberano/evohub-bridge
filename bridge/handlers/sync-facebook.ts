// sync-facebook — fallback por pull para Messenger/Instagram quando o webhook de
// mensagens da Meta/EVO Hub não entrega evento. Deve rodar por cron curto no Coolify.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { getMeta, sendMeta } from "../shared/hub.ts";
import { ingestInbound, type InboundAttachment, repairInboundMedia } from "../shared/inbound.ts";
import { listConversationMessages } from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);

  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const channelId = url.searchParams.get("channel_id") ?? undefined;
  const sinceMinutes = intParam(url, "since_minutes", 360, 1, 10_080);
  const conversationLimit = intParam(url, "conversation_limit", 10, 1, 50);
  const messageLimit = intParam(url, "message_limit", 20, 1, 100);
  const cutoffMs = Date.now() - sinceMinutes * 60_000;

  const db = admin();
  let query = db.from("channels")
    .select("id,type,name,status,page_id,ig_id,display_name,chatwoot_inbox_identifier")
    .in("type", ["facebook", "instagram"])
    .eq("status", "active");
  if (channelId) query = query.eq("id", channelId);

  const { data: rawChannels, error: channelError } = await query;
  if (channelError) return json({ error: channelError.message }, 500);
  const channels = (rawChannels ?? []).filter((c: Json) => (c.type === "instagram" ? c.ig_id : c.page_id));

  const totals = {
    channels: channels?.length ?? 0,
    conversations_scanned: 0,
    inbound_found: 0,
    inserted: 0,
    duplicates: 0,
    skipped_self: 0,
    media_found: 0,
    media_attached: 0,
    media_repaired: 0,
    media_failed: 0,
    outgoing_found: 0,
    outgoing_sent: 0,
    outgoing_duplicates: 0,
    outgoing_failed: 0,
    stale_conversations: 0,
    errors: [] as string[],
  };

  for (const channel of channels ?? []) {
    try {
      const acct = await accountForChannel(channel.id as string);
      // cursor real: desde a última msg já gravada deste canal (com 2min de superposição p/
      // tolerar clock skew). since_minutes só vira o piso quando o canal não tem msg nenhuma
      // ainda. Sem isso, um gap (deploy, instabilidade) maior que a janela perdia msg pra sempre.
      const lastMs = await lastMessageMs(db, channel.id as string);
      const channelCutoffMs = lastMs ? Math.min(lastMs - 120_000, cutoffMs) : cutoffMs;

      const inbound = await syncInbound(db, channel as Json, { cutoffMs: channelCutoffMs, conversationLimit, messageLimit }, acct);
      totals.conversations_scanned += inbound.conversations_scanned;
      totals.inbound_found += inbound.inbound_found;
      totals.inserted += inbound.inserted;
      totals.duplicates += inbound.duplicates;
      totals.skipped_self += inbound.skipped_self;
      totals.media_found += inbound.media_found;
      totals.media_attached += inbound.media_attached;
      totals.media_repaired += inbound.media_repaired;
      totals.media_failed += inbound.media_failed;

      const outgoing = await syncOutgoing(db, channel as Json, { cutoffMs: channelCutoffMs, messageLimit }, acct);
      totals.outgoing_found += outgoing.outgoing_found;
      totals.outgoing_sent += outgoing.outgoing_sent;
      totals.outgoing_duplicates += outgoing.outgoing_duplicates;
      totals.outgoing_failed += outgoing.outgoing_failed;
      totals.stale_conversations += outgoing.stale_conversations;
      await db.from("channels").update({ last_error: null }).eq("id", channel.id);
    } catch (e) {
      const message = errorMessage(e);
      totals.errors.push(`${channel.name ?? channel.id}: ${message}`);
      await db.from("channels").update({ last_error: message }).eq("id", channel.id);
    }
  }

  await db.from("events").insert({
    source: "sync-facebook",
    event_type: "sync_completed",
    payload: { ...totals, since_minutes: sinceMinutes, conversation_limit: conversationLimit, message_limit: messageLimit },
  });

  return json(totals);
}

async function lastMessageMs(db: Db, channelId: string): Promise<number | null> {
  const { data } = await db.from("messages").select("sent_at")
    .eq("channel_id", channelId).order("sent_at", { ascending: false }).limit(1).maybeSingle();
  const sentAt = data?.sent_at as string | undefined;
  if (!sentAt) return null;
  const ms = Date.parse(sentAt);
  return Number.isNaN(ms) ? null : ms;
}

async function syncInbound(
  db: Db,
  channel: Json,
  opts: { cutoffMs: number; conversationLimit: number; messageLimit: number },
  acct: Awaited<ReturnType<typeof accountForChannel>>,
) {
  const isInstagram = channel.type === "instagram";
  const nodeId = (isInstagram ? channel.ig_id : channel.page_id) as string | undefined;
  const inboxIdentifier = channel.chatwoot_inbox_identifier as string | undefined;
  if (!nodeId) throw new Error("canal sem page_id/ig_id");
  if (!inboxIdentifier) throw new Error("canal sem inbox Chatwoot");

  const { data: secret, error: secretError } = await db.from("channel_secrets")
    .select("channel_token")
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (secretError) throw secretError;
  if (!secret?.channel_token) throw new Error("canal sem token");

  const platformSuffix = isInstagram ? "&platform=instagram" : "";
  const conversationsPath =
    `${nodeId}/conversations?fields=id,updated_time,message_count,participants&limit=${opts.conversationLimit}${platformSuffix}`;
  const convRes = await getMeta(secret.channel_token as string, conversationsPath);
  if (!convRes.ok) throw new Error(`Meta conversations ${convRes.status}: ${JSON.stringify(convRes.data)}`);

  const conversations = ((convRes.data as Json).data ?? []) as Json[];
  const result = {
    conversations_scanned: 0,
    inbound_found: 0,
    inserted: 0,
    duplicates: 0,
    skipped_self: 0,
    media_found: 0,
    media_attached: 0,
    media_repaired: 0,
    media_failed: 0,
  };

  for (const conversation of conversations) {
    const updatedMs = Date.parse(conversation.updated_time as string);
    if (!Number.isNaN(updatedMs) && updatedMs < opts.cutoffMs) continue;
    result.conversations_scanned++;

    const messagesPath =
      `${conversation.id}/messages?fields=id,from,to,message,created_time,attachments&limit=${opts.messageLimit}`;
    const msgRes = await getMeta(secret.channel_token as string, messagesPath);
    if (!msgRes.ok) throw new Error(`Meta messages ${msgRes.status}: ${JSON.stringify(msgRes.data)}`);

    const messages = (((msgRes.data as Json).data ?? []) as Json[]).slice().reverse();
    for (const message of messages) {
      const createdMs = Date.parse(message.created_time as string);
      if (!Number.isNaN(createdMs) && createdMs < opts.cutoffMs) continue;

      const from = (message.from ?? {}) as Json;
      const senderId = from.id as string | undefined;
      if (!senderId) continue;
      // mensagem enviada PELA PÁGINA (app/aparelho) = SAÍDA; contato = destinatário (to).
      // Antes era pulada (skipped_self) -> mensagem do aparelho não chegava no chat.
      const isFromPage = senderId === nodeId;
      let contactId = senderId;
      let contactName = from.name as string | undefined;
      if (isFromPage) {
        const to = (((message.to as Json)?.data as Json[]) ?? [])[0] as Json | undefined;
        contactId = (to?.id as string | undefined) ?? "";
        contactName = to?.name as string | undefined;
        if (!contactId) continue; // sem destinatário identificável
      }

      result.inbound_found++;
      const metaMessageId = message.id as string | undefined;
      if (metaMessageId) {
        const { data: existingMessages, error: existingError } = await db.from("messages")
          .select("id,content,media_url")
          .eq("meta_message_id", metaMessageId)
          .limit(1);
        if (existingError) throw existingError;
        const existingMessage = existingMessages?.[0] as Json | undefined;
        if (existingMessage?.id) {
          const metaAttachments = extractAttachments(message);
          if (!existingMessage.media_url && metaAttachments.length > 0) {
            const attachments = await downloadAttachments(metaAttachments, result);
            const msgType = inboundMsgType(message, attachments);
            const content = (message.message as string | undefined)?.trim() || fallbackContent(msgType);
            const repair = await repairInboundMedia(db, existingMessage.id as string, {
              msgType,
              content,
              attachments,
            });
            if (repair.repaired) result.media_repaired++;
          }
          result.duplicates++;
          continue;
        }
      }

      const metaAttachments = extractAttachments(message);
      const attachments = await downloadAttachments(metaAttachments, result);
      const msgType = inboundMsgType(message, attachments);
      const content = (message.message as string | undefined)?.trim() || fallbackContent(msgType);
      const ingest = await ingestInbound(db, channel, {
        from: contactId,
        name: contactName,
        metaMessageId,
        msgType,
        content,
        sentAt: message.created_time as string | undefined,
        attachments,
        outgoing: isFromPage,
        acct,
      });

      if (ingest.inserted) result.inserted++;
      else if (ingest.reason === "duplicate") result.duplicates++;
    }
  }

  return result;
}

async function syncOutgoing(
  db: Db,
  channel: Json,
  opts: { cutoffMs: number; messageLimit: number },
  acct: Awaited<ReturnType<typeof accountForChannel>>,
) {
  const { data: secret, error: secretError } = await db.from("channel_secrets")
    .select("channel_token")
    .eq("channel_id", channel.id)
    .maybeSingle();
  if (secretError) throw secretError;
  if (!secret?.channel_token) throw new Error("canal sem token");

  const { data: conversations, error: convError } = await db.from("conversations")
    .select("*, contacts(*)")
    .eq("channel_id", channel.id)
    .neq("status", "resolved")
    .order("opened_at", { ascending: false })
    .limit(20);
  if (convError) throw convError;

  const result = {
    outgoing_found: 0, outgoing_sent: 0, outgoing_duplicates: 0,
    outgoing_failed: 0, stale_conversations: 0,
  };

  for (const conversation of conversations ?? []) {
    const cwConversationId = conversation.chatwoot_conversation_id as number | undefined;
    const contact = conversation.contacts as Json | undefined;
    const to = contact?.external_contact_id as string | undefined;
    if (!cwConversationId || !to) continue;

    let messages: Json[];
    try {
      messages = (await listConversationMessages(cwConversationId, acct)).slice(-opts.messageLimit);
    } catch (error) {
      // Conversas apagadas durante limpeza não podem interromper o canal inteiro.
      if (errorMessage(error).includes(" 404:")) {
        result.stale_conversations++;
        await db.from("conversations").update({ status: "resolved" }).eq("id", conversation.id);
        continue;
      }
      throw error;
    }
    for (const message of messages) {
      if (!isOutgoingMessage(message)) continue;
      const createdMs = chatwootCreatedAtMs(message.created_at);
      if (createdMs && createdMs < opts.cutoffMs) continue;

      const cwMessageId = message.id as number | undefined;
      const content = (message.content as string | undefined)?.trim();
      if (!cwMessageId || !content) continue;

      result.outgoing_found++;

      const { data: existingMessages, error: existingError } = await db.from("messages")
        .select("id,status")
        .eq("direction", "out")
        .eq("chatwoot_message_id", cwMessageId)
        .limit(1);
      if (existingError) throw existingError;
      const existing = existingMessages?.[0];
      if (existing?.status === "sent") {
        result.outgoing_duplicates++;
        continue;
      }

      const sent = await sendMessenger(secret.channel_token as string, to, content);
      const payload = {
        conversation_id: conversation.id,
        channel_id: channel.id,
        direction: "out",
        msg_type: "text",
        content,
        meta_message_id: sent.metaId,
        chatwoot_message_id: cwMessageId,
        status: sent.ok ? "sent" : "failed",
        sent_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error: updateError } = await db.from("messages").update(payload).eq("id", existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await db.from("messages").insert(payload);
        if (insertError) throw insertError;
      }

      if (sent.ok) result.outgoing_sent++;
      else result.outgoing_failed++;
    }
  }

  return result;
}

function isOutgoingMessage(message: Json): boolean {
  if (message.private === true) return false;
  return message.message_type === "outgoing" || message.message_type === 1;
}

function chatwootCreatedAtMs(value: unknown): number | null {
  if (typeof value === "number") return value * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

async function downloadAttachments(
  metaAttachments: Json[],
  result: { media_found: number; media_attached: number; media_failed: number },
): Promise<InboundAttachment[]> {
  const attachments: InboundAttachment[] = [];
  for (const metaAttachment of metaAttachments) {
    result.media_found++;
    try {
      const downloaded = await downloadAttachment(metaAttachment);
      if (downloaded) {
        attachments.push(downloaded);
        result.media_attached++;
      } else {
        result.media_failed++;
      }
    } catch {
      result.media_failed++;
    }
  }
  return attachments;
}

async function downloadAttachment(metaAttachment: Json): Promise<InboundAttachment | null> {
  const sourceUrl = attachmentUrl(metaAttachment);
  if (!sourceUrl) return null;

  const declaredSize = numberValue(metaAttachment.size);
  if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) {
    throw new Error("Meta attachment exceeds size limit");
  }

  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Meta attachment download ${res.status}`);

  const length = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES) {
    throw new Error("Meta attachment response exceeds size limit");
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("Meta attachment body exceeds size limit");
  }

  const contentType = cleanContentType(res.headers.get("content-type")) ??
    cleanContentType(metaAttachment.mime_type as string | undefined) ??
    "application/octet-stream";
  return {
    filename: attachmentFilename(metaAttachment, contentType),
    contentType,
    bytes,
    sourceUrl,
  };
}

function extractAttachments(message: Json): Json[] {
  const attachments = message.attachments as Json | undefined;
  const data = attachments?.data;
  return Array.isArray(data) ? data as Json[] : [];
}

function inboundMsgType(message: Json, attachments: InboundAttachment[]): string {
  const text = (message.message as string | undefined)?.trim();
  if (text && attachments.length === 0) return "text";

  const firstAttachment = attachments[0];
  if (firstAttachment) return msgTypeFromMime(firstAttachment.contentType);

  const firstMeta = extractAttachments(message)[0];
  const mime = cleanContentType(firstMeta?.mime_type as string | undefined);
  return mime ? msgTypeFromMime(mime) : (text ? "text" : "unknown");
}

function msgTypeFromMime(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  if (mime.includes("pdf") || mime.includes("document") || mime.includes("sheet") || mime.includes("presentation")) {
    return "document";
  }
  return "unknown";
}

function fallbackContent(msgType: string): string {
  if (msgType === "image") return "[imagem]";
  if (msgType === "audio") return "[audio]";
  if (msgType === "video") return "[video]";
  if (msgType === "document") return "[documento]";
  return "[anexo]";
}

function attachmentUrl(metaAttachment: Json): string | null {
  const imageData = metaAttachment.image_data as Json | undefined;
  const videoData = metaAttachment.video_data as Json | undefined;
  const audioData = metaAttachment.audio_data as Json | undefined;
  return stringValue(metaAttachment.file_url) ??
    stringValue(imageData?.url) ??
    stringValue(videoData?.url) ??
    stringValue(audioData?.url) ??
    null;
}

function attachmentFilename(metaAttachment: Json, contentType: string): string {
  const base = stringValue(metaAttachment.name) ?? stringValue(metaAttachment.id) ?? "attachment";
  const clean = base.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 120) || "attachment";
  if (/\.[A-Za-z0-9]{2,5}$/.test(clean)) return clean;
  return `${clean}${extensionForMime(contentType)}`;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/mp4" || mime === "video/mp4") return ".mp4";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

function cleanContentType(value: string | null | undefined): string | null {
  const clean = value?.split(";")[0]?.trim().toLowerCase();
  return clean || null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function sendMessenger(channelToken: string, to: string, content: string) {
  const res = await sendMeta(channelToken, "me/messages", {
    recipient: { id: to },
    message: { text: content },
    messaging_type: "RESPONSE",
  });
  const data = res.data as Json;
  return {
    ok: res.ok,
    metaId: (data.message_id as string | undefined) ?? null,
  };
}

function isAuthorized(req: Request, url: URL): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = bearer || url.searchParams.get("token") || "";
  const expected = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  return timingSafeEqual(token, expected);
}

function intParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(url.searchParams.get(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
