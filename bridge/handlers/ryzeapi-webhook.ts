// ryzeapi-webhook — recebe eventos da RyzeAPI (teste/avaliação, provedor alternativo de
// WhatsApp não-oficial). A ponte nativa Chatwoot deles funciona bem pra SAÍDA, mas não cria
// conversa pra mensagens de ENTRADA de forma confiável (bug observado, achado testando) --
// por isso processamos a entrada por aqui, com ingestInbound() (mesma função usada pro Hub
// oficial), em vez de depender da ponte deles. Saída continua pela ponte nativa deles.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { ingestInbound, type InboundAttachment } from "../shared/inbound.ts";
import { accountForChannel } from "../shared/accounts.ts";

type Json = Record<string, unknown>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function jidDigits(value: unknown): string {
  return String(value ?? "").replace(/@.*/, "").replace(/\D/g, "");
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = optionalEnv("RYZEAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
  if (!timingSafeEqual(token, expected)) return new Response("unauthorized", { status: 401 });

  let p: Json;
  try { p = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const eventType = (p.event as string) ?? "ryzeapi_event";
  const occurredAt = (p.data as Json | undefined)?.timestamp as string | undefined;
  const db = admin();
  db.from("events").insert({ source: "ryzeapi", event_type: eventType, payload: p, occurred_at: occurredAt ?? null }).then(() => {}, () => {});

  // Processa em BACKGROUND e responde 200 na hora — com mídia em base64 (pode ser pesada) +
  // ingestInbound (banco + upload pro Chatwoot) facilmente passa de 2-3s. Esperar isso antes
  // de responder faz o dispatcher de webhook da RyzeAPI achar que estamos lentos/fora e parar
  // de entregar (suspeita forte do porquê a entrega parou no teste anterior).
  if (eventType === "message.exchange") {
    handleMessageExchange(db, p).catch((e) => console.error("ryzeapi-webhook handleMessageExchange erro:", e));
  }
  return new Response("ok", { status: 200 });
}

async function handleMessageExchange(db: ReturnType<typeof admin>, p: Json) {
  // Estrutura real do webhook ryzeapi (confirmada via tabela `events`, payload de produção):
  //   p.data.id              = wamid (top-level)
  //   p.data.direction       "incoming" | "outgoing" (NÃO dentro de message)
  //   p.data.chat.jid        JID do chat (NÃO dentro de message)
  //   p.data.sender.jid      JID do remetente (NÃO dentro de message)
  //   p.data.message.content    texto -- STRING direta, não objeto {text}
  //   p.data.message.media.*    mídia (type/url/base64/...)
  //   p.data.timestamp       ISO timestamp (NÃO dentro de message)
  const data = (p.data ?? {}) as Json;
  const chat = (data.chat ?? {}) as Json;
  if (chat.type && chat.type !== "private") return; // grupo/newsletter -- fora de escopo por agora

  const instanceData = (p.instanceData ?? {}) as Json;
  const instanceName = instanceData.instance as string | undefined;
  if (!instanceName) return;

  let channel = (await db.from("channels").select("*").eq("external_id", instanceName).maybeSingle()).data as Json | null;
  if (!channel) {
    channel = (await db.from("channels").select("*").eq("name", instanceName).maybeSingle()).data as Json | null;
  }
  if (!channel) { console.warn("ryzeapi: sem canal cadastrado pra instância", instanceName); return; }

  const message = (data.message ?? {}) as Json;
  const sender = (data.sender ?? {}) as Json;
  const recipient = (data.recipient ?? {}) as Json;
  const ownDigits = jidDigits(channel.phone_number);
  const senderDigits = jidDigits(sender.jid ?? sender.lid);
  const chatDigits = jidDigits(chat.jid ?? chat.lid);
  const recipientDigits = jidDigits(recipient.jid ?? recipient.lid);
  const direction = String(data.direction ?? "");
  const source = String(message.source ?? "");

  // A Ryze tem entregue alguns eventos do cliente como "outgoing" e, logo depois,
  // um espelho "incoming" com o número da própria caixa. Aqui escolhemos o lado que
  // representa o cliente e ignoramos o espelho/eco da própria instância.
  let from = "";
  if (direction === "incoming") {
    if (senderDigits && senderDigits !== ownDigits) from = senderDigits;
    else if (chatDigits && chatDigits !== ownDigits) from = chatDigits;
    else return; // espelho da própria caixa
  } else if (direction === "outgoing") {
    if (source === "api") return; // saída iniciada pelo Chatwoot/API
    if (senderDigits && senderDigits !== ownDigits) from = senderDigits;
    else if (chatDigits && chatDigits !== ownDigits) from = chatDigits;
    else if (recipientDigits && recipientDigits !== ownDigits) from = recipientDigits;
    else return;
  } else {
    return;
  }

  const content = (message.content as string) ?? "";

  // type determinado pela mídia presente (image/video/audio/document/sticker/ptt)
  const media = message.media as Json | undefined;
  const msgType = (media?.type as string) || (content ? "text" : "unknown");

  const messageId = (data.id as string) ?? undefined;

  const attachments = buildAttachment(message);
  const acct = await accountForChannel(channel.id as string);

  await ingestInbound(db, channel as Json, {
    from,
    name: (chat.name as string) || (sender.name as string) || undefined,
    metaMessageId: messageId,
    msgType,
    content,
    attachments,
    sentAt: data.timestamp as string | undefined,
    acct,
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
