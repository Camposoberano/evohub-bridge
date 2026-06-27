// send-outbound — disparo proativo controlado (n8n/funil de apresentação). O n8n NÃO cria
// mensagem direto no Chatwoot porque mensagem criada via API REST do Chatwoot NÃO dispara o
// webhook de inbox -> o bridge nunca entregaria. Então o n8n chama AQUI: este endpoint
// (1) entrega no WhatsApp pelo canal certo e (2) registra no Chatwoot pro atendente ver
// (registro via API não re-dispara webhook -> sem loop).
//
// Tipos: text | image | audio | video | interactive (botões).
// Body: { chatwoot_conversation_id, type, payload }
//   text        -> { content }
//   image/video -> { media_url, caption? }
//   audio       -> { media_url }
//   interactive -> { text, buttons:[{id,title}], header_image? }
// Compat: { chatwoot_conversation_id, content } sem type vira text.
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { sendMeta } from "../shared/hub.ts";
import { createConversationMessage } from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET"))) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const cwConvId = Number(body.chatwoot_conversation_id);
  if (!cwConvId) return json({ error: "chatwoot_conversation_id obrigatório" }, 400);

  // compat: content direto = texto
  const type = (body.type as string) ?? "text";
  const payload = (body.payload as Json) ?? (body.content ? { content: body.content } : {});

  const db = admin();
  const { data: conv } = await db.from("conversations").select("*, contacts(*), channels(*)")
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (!conv) return json({ error: "conversa não encontrada p/ " + cwConvId }, 404);
  const channel = conv.channels as Json;
  const to = (conv.contacts as Json)?.external_contact_id as string | undefined;
  if (!channel || !to) return json({ error: "canal ou destinatário ausente" }, 404);

  const isWhatsapp = channel.type === "whatsapp";
  if (isWhatsapp && !channel.phone_number_id) return json({ error: "WhatsApp sem phone_number_id (uazapi não suportado aqui)" }, 422);

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const channelToken = secret?.channel_token as string | undefined;
  if (!channelToken) return json({ error: "canal sem token" }, 404);

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
    const link = payload.media_url as string;
    if (!link) return json({ error: "media_url obrigatório" }, 400);
    metaBody = { type: "audio", audio: { link } }; // áudio não aceita caption
    registroTexto = "[áudio]";
  } else if (type === "interactive") {
    const text = (payload.text as string) ?? "";
    const buttons = (payload.buttons as { id: string; title: string }[]) ?? [];
    if (!text || buttons.length === 0) return json({ error: "text e buttons obrigatórios" }, 400);
    const interactive: Json = {
      type: "button",
      body: { text },
      action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    };
    if (payload.header_image) interactive.header = { type: "image", image: { link: payload.header_image } };
    metaBody = { type: "interactive", interactive };
    registroTexto = text + " [" + buttons.map((b) => b.title).join(" / ") + "]";
  } else {
    return json({ error: "tipo desconhecido: " + type }, 400);
  }

  const path = isWhatsapp ? `${channel.phone_number_id}/messages` : "me/messages";
  const metaPayload = isWhatsapp
    ? { messaging_product: "whatsapp", to, ...metaBody }
    : { recipient: { id: to }, message: { text: registroTexto }, messaging_type: "RESPONSE" }; // FB/IG: só texto
  const res = await sendMeta(channelToken, path, metaPayload);

  const d = res.data as Json;
  const metaId = (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ?? ((d?.message_id as string) ?? null);

  // registra no Chatwoot pro atendente ver (não re-dispara webhook).
  const acct = await accountForChannel(channel.id as string);
  let cwMsgId: number | undefined;
  try {
    const cwMsg = await createConversationMessage(cwConvId, { content: registroTexto, messageType: "outgoing" }, acct);
    cwMsgId = cwMsg?.id;
  } catch (e) {
    console.warn("send-outbound: registro Chatwoot falhou (entrega ok):", String(e).slice(0, 150));
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

  if (!res.ok) console.error("send-outbound falhou:", JSON.stringify(d).slice(0, 250));
  return json({ ok: res.ok, meta_message_id: metaId, status: res.status, error: res.ok ? undefined : (d as Json)?.error });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
