// ryzeapi-webhook — recebe eventos da RyzeAPI (teste/avaliação, provedor alternativo de
// WhatsApp não-oficial). A ponte nativa Chatwoot deles funciona bem pra SAÍDA, mas não cria
// conversa pra mensagens de ENTRADA de forma confiável (bug observado, achado testando) --
// por isso processamos a entrada por aqui, com ingestInbound() (mesma função usada pro Hub
// oficial), em vez de depender da ponte deles. Saída continua pela ponte nativa deles.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { ingestInbound, type InboundAttachment } from "../shared/inbound.ts";

type Json = Record<string, unknown>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = optionalEnv("RYZEAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
  if (!timingSafeEqual(token, expected)) return new Response("unauthorized", { status: 401 });

  let p: Json;
  try { p = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const eventType = (p.event as string) ?? "ryzeapi_event";
  const db = admin();
  db.from("events").insert({ source: "ryzeapi", event_type: eventType, payload: p }).then(() => {}, () => {});

  if (eventType === "message.exchange") {
    try { await handleMessageExchange(db, p); } catch (e) { console.error("ryzeapi-webhook handleMessageExchange erro:", e); }
  }
  return new Response("ok", { status: 200 });
}

async function handleMessageExchange(db: ReturnType<typeof admin>, p: Json) {
  const data = (p.data ?? {}) as Json;
  if (data.direction !== "incoming") return; // saída já vai pela ponte nativa deles
  const chat = (data.chat ?? {}) as Json;
  if (chat.type && chat.type !== "private") return; // grupo/newsletter -- fora de escopo por agora

  const instanceData = (p.instanceData ?? {}) as Json;
  const instanceName = instanceData.instance as string | undefined;
  if (!instanceName) return;

  const { data: channel } = await db.from("channels").select("*").eq("external_id", instanceName).maybeSingle();
  if (!channel) { console.warn("ryzeapi: sem canal cadastrado pra instância", instanceName); return; }

  const sender = (data.sender ?? chat) as Json;
  const fromRaw = (sender.jid ?? chat.jid ?? sender.lid ?? chat.lid) as string | undefined;
  if (!fromRaw) return;
  const from = String(fromRaw).replace(/@.*/, ""); // "55119...@s.whatsapp.net" -> só os dígitos

  const message = (data.message ?? {}) as Json;
  const content = (message.content as string) ?? "";
  const msgType = (message.type as string) ?? "text";
  const messageId = data.id as string | undefined;

  const attachments = buildAttachment(message);

  await ingestInbound(db, channel as Json, {
    from,
    name: (chat.name as string) || (sender.name as string) || undefined,
    metaMessageId: messageId,
    msgType,
    content,
    attachments,
    sentAt: data.timestamp as string | undefined,
  });
}

// mídia chega decriptada em base64 (webhook configurado com mediaBase64=true) -- a URL crua
// da Meta/WhatsApp (mmg.whatsapp.net/*.enc) vem cifrada e exigiria implementar a decriptação
// do protocolo, então usamos o base64 que a RyzeAPI já decripta do lado dela.
function buildAttachment(message: Json): InboundAttachment[] | undefined {
  const media = message.media as Json | undefined;
  if (!media?.base64) return undefined;
  const base64 = media.base64 as string;
  const fileSize = (media.fileSize as number) ?? 0;
  if (fileSize > MAX_ATTACHMENT_BYTES) return undefined;
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)); } catch { return undefined; }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return undefined;
  const mimetype = (media.mimetype as string) ?? "application/octet-stream";
  const filename = (media.fileName as string) ?? `${messageDefaultName(message)}${extensionForMime(mimetype)}`;
  return [{ filename, contentType: mimetype, bytes }];
}

function messageDefaultName(message: Json): string {
  return `${(message.type as string) ?? "arquivo"}-${crypto.randomUUID().slice(0, 8)}`;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "audio/mpeg" || mime === "audio/mp3") return ".mp3";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "application/pdf") return ".pdf";
  return "";
}
