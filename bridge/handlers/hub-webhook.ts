// hub-webhook — recebe webhooks do EVO Hub.
//  * lifecycle (event_type): channel_connected / channel_disconnected / channel_auto_imported
//  * passthrough Meta (object): whatsapp_business_account / page / instagram
//
// Fase 1: WhatsApp TEXTO ponta a ponta (Meta -> Chatwoot + Postgres).
// FB/IG e mídia: evento é persistido; tradução fica para Fase 2/3 (TODO marcados).
import { admin, claimDelivery } from "../shared/supabase.ts";
import { verifyHubSignature } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { getChannelDetail, getMeta } from "../shared/hub.ts";
import { ingestInbound, type InboundAttachment } from "../shared/inbound.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const WA_MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get("X-Hub-Signature-256");
  const deliveryId = req.headers.get("X-Hub-Delivery-Id");

  if (!(await verifyHubSignature(env("EVOLUTION_HUB_WEBHOOK_SECRET"), raw, sig))) {
    return new Response("invalid signature", { status: 401 });
  }

  const db = admin();

  if (!(await claimDelivery(db, deliveryId, "hub"))) {
    return new Response("ok (dup)", { status: 200 });
  }

  let payload: Json;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  await db.from("events").insert({
    source: "hub",
    event_type: (payload.event_type as string) ?? (payload.event as string) ?? (payload.object as string) ?? "unknown",
    payload,
    occurred_at: (payload.occurred_at as string) ?? null,
  });

  try {
    const eventType = payload.event_type as string | undefined;
    if (eventType && ["channel_connected", "channel_disconnected", "channel_auto_imported"].includes(eventType)) {
      await handleLifecycle(db, payload);
    } else if (payload.object === "whatsapp_business_account") {
      await handleWhatsApp(db, payload);
    } else if (payload.object === "page" || payload.object === "instagram") {
      await handleMessenger(db, payload);
    } else {
      console.log("passthrough não tratado:", payload.object);
    }
  } catch (e) {
    console.error("hub-webhook erro:", e);
    return new Response("ok (logged error)", { status: 200 });
  }

  return new Response("ok", { status: 200 });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function handleLifecycle(db: Db, p: Json) {
  const externalId = p.external_id as string;
  const hubChannelId = p.channel_id as string;
  const eventType = p.event_type as string;

  const patch: Json = { hub_channel_id: hubChannelId ?? null };

  if (eventType === "channel_connected" || eventType === "channel_auto_imported") {
    patch.status = "active";
    patch.connected_at = new Date().toISOString();

    // O webhook channel_connected é magro (sem meta_connection). Buscamos o detalhe no Hub
    // pra extrair page_id (FB) / phone_number_id+waba_id (WA) / ig_id (IG).
    const detail = await getChannelDetail(hubChannelId);
    if (detail) {
      const fb = (detail.facebook_connection ?? {}) as Json;
      const wa = (detail.whatsapp_connection ?? detail.meta_connection ?? {}) as Json;
      const ig = (detail.instagram_connection ?? {}) as Json;
      if (fb.page_id) { patch.page_id = fb.page_id; patch.display_name = fb.page_name ?? null; }
      if (wa.phone_number_id) {
        patch.phone_number_id = wa.phone_number_id;
        patch.waba_id = wa.waba_id ?? null;
        patch.phone_number = wa.phone_number ?? null;
        patch.display_name = (patch.display_name as string | undefined) ?? wa.display_name ?? null;
      }
      const igId = ig.instagram_user_id ?? ig.ig_id ?? ig.instagram_id ?? ig.id;
      if (igId) {
        patch.ig_id = igId;
        patch.display_name = (patch.display_name as string | undefined) ?? ig.username ?? null;
      }
      // channel_token vem no detalhe — guarda/atualiza (idempotente).
      if (detail.token) {
        await db.from("channel_secrets").upsert({ channel_id: externalId, channel_token: detail.token as string });
      }
    }
  } else if (eventType === "channel_disconnected") {
    patch.status = "inactive";
  }

  await db.from("channels").update(patch).eq("id", externalId);
}

// ── WhatsApp passthrough (entrada) ───────────────────────────────────────────
async function handleWhatsApp(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    for (const change of ((entry.changes ?? []) as Json[])) {
      const value = (change.value ?? {}) as Json;
      const phoneNumberId = (value.metadata as Json)?.phone_number_id as string | undefined;
      if (!phoneNumberId) continue;

      const { data: channel } = await db.from("channels").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (!channel?.chatwoot_inbox_identifier) {
        console.warn("canal sem inbox_identifier p/ phone_number_id", phoneNumberId);
        continue;
      }

      const contactsMeta = (value.contacts ?? []) as Json[];
      const messages = (value.messages ?? []) as Json[];
      if (messages.length === 0) continue;

      let token: string | undefined;
      if (messages.some((m) => WA_MEDIA_TYPES.has(m.type as string))) {
        const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
        token = secret?.channel_token as string | undefined;
      }

      for (const m of messages) {
        const from = m.from as string;
        const profileName = (contactsMeta.find((c) => (c.wa_id as string) === from)?.profile as Json)?.name as string | undefined;

        const type = m.type as string;
        let content: string;
        let attachments: InboundAttachment[] | undefined;

        if (type === "text") {
          content = ((m.text as Json)?.body as string) ?? "";
        } else if (WA_MEDIA_TYPES.has(type) && token) {
          const media = (m[type] ?? {}) as Json;
          const mediaId = stringValue(media.id);
          const caption = stringValue(media.caption);
          const filenameHint = type === "document" ? stringValue(media.filename) ?? undefined : undefined;
          const downloaded = mediaId ? await downloadWhatsAppMedia(token, mediaId, filenameHint) : null;
          if (downloaded) {
            attachments = [downloaded];
            content = caption ?? fallbackContent(type);
          } else {
            content = fallbackContent(type);
          }
        } else {
          content = `[${type}]`; // tipo sem tradução (location/contacts/interactive/etc.)
        }

        await ingestInbound(db, channel as Json, {
          from,
          name: profileName,
          metaMessageId: m.id as string,
          msgType: type,
          content,
          attachments,
        });
      }
    }
  }
}

// ── Messenger / Instagram passthrough (entrada) ──────────────────────────────
async function handleMessenger(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    const pageId = entry.id as string | undefined; // page_id (FB) ou ig id
    if (!pageId) continue;

    const { data: channel } = await db.from("channels").select("*")
      .or(`page_id.eq.${pageId},ig_id.eq.${pageId}`).maybeSingle();
    if (!channel?.chatwoot_inbox_identifier) {
      console.warn("sem canal p/ page/ig id", pageId);
      continue;
    }

    for (const m of ((entry.messaging ?? []) as Json[])) {
      const sender = (m.sender as Json)?.id as string | undefined;
      const message = m.message as Json | undefined;
      if (!sender || !message) continue; // ignora delivery/read/postback sem texto
      if (message.is_echo) continue; // ignora echo das mensagens enviadas pela própria página
      if (hasMessengerAttachments(message)) continue; // o sync-facebook baixa e envia a mídia real
      const text = (message.text as string) ?? "[anexo]"; // TODO Fase 3: mídia/attachments

      await ingestInbound(db, channel as Json, {
        from: sender,
        name: undefined,
        metaMessageId: (message.mid as string) ?? "",
        msgType: "text",
        content: text,
      });
    }
  }
}

function hasMessengerAttachments(message: Json): boolean {
  const attachments = message.attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

// ── Mídia WhatsApp (entrada) ──────────────────────────────────────────────────
// Diferente do FB/IG (URL pública direta), mídia WA exige 2 passos:
// 1) GET /meta/<media_id> (Hub) -> { url, mime_type, file_size }
// 2) fetch(url) com Authorization: Bearer <channel_token> -> bytes
async function downloadWhatsAppMedia(token: string, mediaId: string, filenameHint?: string): Promise<InboundAttachment | null> {
  const info = await getMeta(token, mediaId);
  if (!info.ok) return null;
  const d = info.data as Json;
  const url = stringValue(d.url);
  if (!url) return null;

  const declaredSize = typeof d.file_size === "number" ? d.file_size : null;
  if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) return null;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;

  const length = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;

  const contentType = cleanContentType(res.headers.get("content-type")) ??
    cleanContentType(d.mime_type as string | undefined) ??
    "application/octet-stream";

  return {
    filename: filenameHint ?? `${mediaId}${extensionForMime(contentType)}`,
    contentType,
    bytes,
    sourceUrl: url,
  };
}

function fallbackContent(type: string): string {
  if (type === "image") return "[imagem]";
  if (type === "audio") return "[audio]";
  if (type === "video") return "[video]";
  if (type === "document") return "[documento]";
  if (type === "sticker") return "[sticker]";
  return "[anexo]";
}

function cleanContentType(value: string | null | undefined): string | null {
  const clean = value?.split(";")[0]?.trim().toLowerCase();
  return clean || null;
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

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
