// chatwoot-webhook — recebe webhooks do Chatwoot.
//  * message_created (outgoing) -> envia ao cliente via EVO Hub /meta/*.
//  * demais eventos -> persistidos para analytics.
//
// Auth: o inbox é criado com webhook_url contendo ?token=<CHATWOOT_WEBHOOK_SECRET>.
// Validamos esse token. TODO Fase 5: usar assinatura nativa se a versão suportar.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { sendMeta } from "../shared/hub.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

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

  await db.from("events").insert({ source: "chatwoot", event_type: eventName, payload: p });

  try {
    if (eventName === "message_created" && isOutgoing(p) && !p.private) {
      await handleOutgoing(db, p);
    }
    // TODO Fase 4: conversation_created / conversation_resolved / contact_created -> métricas
  } catch (e) {
    console.error("chatwoot-webhook erro:", e);
    return new Response("ok (logged error)", { status: 200 });
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

  if (!cwConversationId || (!content && !attachment)) return;

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
    if (!content) { console.warn("WA: envio de anexo sem texto ainda não suportado", channel.id); return; }
    res = await sendMeta(token, `${channel.phone_number_id}/messages`, {
      messaging_product: "whatsapp", to, type: "text", text: { body: content },
    });
  } else if (content) {
    // facebook / instagram (Messenger): envia pela página (me), destinatário = PSID/IGSID.
    res = await sendMeta(token, "me/messages", {
      recipient: { id: to }, message: { text: content }, messaging_type: "RESPONSE",
    });
  } else {
    // anexo sem texto: usa o data_url público do Chatwoot (Active Storage) como payload.
    mediaUrl = (attachment!.data_url as string) ?? null;
    if (!mediaUrl) { console.warn("anexo sem data_url", channel.id); return; }
    const attachType = metaAttachmentType(attachment!.file_type as string | undefined);
    msgType = attachType === "file" ? "document" : attachType;
    res = await sendMeta(token, "me/messages", {
      recipient: { id: to },
      message: { attachment: { type: attachType, payload: { url: mediaUrl, is_reusable: true } } },
      messaging_type: "RESPONSE",
    });
  }

  const d = res.data as Json;
  const metaId = (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ??
    ((d?.message_id as string) ?? null);

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
