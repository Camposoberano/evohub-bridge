// send-outbound — disparo proativo controlado (n8n/funil de apresentação). O n8n NÃO cria
// mensagem direto no Chatwoot porque mensagem criada via API REST do Chatwoot NÃO dispara o
// webhook de inbox -> o bridge nunca entregaria. Então o n8n chama AQUI: este endpoint
// (1) entrega no WhatsApp/FB/IG pelo canal certo e (2) registra a mensagem no Chatwoot pro
// atendente ver (registro via API não re-dispara webhook -> sem loop).
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET> (mesmo segredo dos outros webhooks internos).
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
  const content = (body.content as string) ?? "";
  if (!cwConvId || !content.trim()) return json({ error: "chatwoot_conversation_id e content obrigatórios" }, 400);

  const db = admin();

  // conversa -> canal + contato (destinatário)
  const { data: conv } = await db.from("conversations").select("*, contacts(*), channels(*)")
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (!conv) return json({ error: "conversa não encontrada p/ chatwoot_conversation_id " + cwConvId }, 404);
  const channel = conv.channels as Json;
  const to = (conv.contacts as Json)?.external_contact_id as string | undefined;
  if (!channel || !to) return json({ error: "canal ou destinatário ausente" }, 404);

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const channelToken = secret?.channel_token as string | undefined;
  if (!channelToken) return json({ error: "canal sem token" }, 404);

  // entrega por tipo de canal (Meta: WhatsApp oficial / FB / IG). uazapi fica p/ depois.
  let res;
  if (channel.type === "whatsapp") {
    if (!channel.phone_number_id) return json({ error: "canal WhatsApp sem phone_number_id (uazapi ainda não suportado aqui)" }, 422);
    res = await sendMeta(channelToken, `${channel.phone_number_id}/messages`, {
      messaging_product: "whatsapp", to, type: "text", text: { body: content },
    });
  } else {
    res = await sendMeta(channelToken, "me/messages", {
      recipient: { id: to }, message: { text: content }, messaging_type: "RESPONSE",
    });
  }

  const d = res.data as Json;
  const metaId = (d?.messages ? ((d.messages as Json[])[0]?.id as string) : null) ?? ((d?.message_id as string) ?? null);

  // registra no Chatwoot pro atendente ver o histórico (não re-dispara webhook).
  const acct = await accountForChannel(channel.id as string);
  let cwMsgId: number | undefined;
  try {
    const cwMsg = await createConversationMessage(cwConvId, { content, messageType: "outgoing" }, acct);
    cwMsgId = cwMsg?.id;
  } catch (e) {
    console.warn("send-outbound: registro no Chatwoot falhou (entrega ok):", String(e).slice(0, 150));
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

  return json({ ok: res.ok, meta_message_id: metaId, status: res.status });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
