// chatwoot-webhook — recebe webhooks do Chatwoot.
//  * message_created (outgoing) -> envia ao cliente via EVO Hub /meta/*.
//  * demais eventos -> persistidos para analytics.
//
// Auth: o inbox é criado com webhook_url contendo ?token=<CHATWOOT_WEBHOOK_SECRET>.
// Validamos esse token. TODO Fase 5: usar assinatura nativa se a versão suportar.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import { sendMetaMessage } from "../shared/hub.ts";

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

  if (!cwConversationId || !content) return;

  const { data: channel } = await db.from("channels").select("*").eq("chatwoot_inbox_id", cwInboxId!).maybeSingle();
  if (!channel?.phone_number_id) { console.warn("canal sem phone_number_id p/ inbox", cwInboxId); return; }

  const { data: conv } = await db.from("conversations").select("*, contacts(*)")
    .eq("channel_id", channel.id).eq("chatwoot_conversation_id", cwConversationId).maybeSingle();
  const to = (conv?.contacts as Json)?.external_contact_id as string | undefined;
  if (!to) { console.warn("sem destinatário p/ conversa", cwConversationId); return; }

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).single();

  const res = await sendMetaMessage(secret!.channel_token, channel.phone_number_id, {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: content },
  });

  const metaId = (res.data as Json)?.messages
    ? (((res.data as Json).messages as Json[])[0]?.id as string)
    : null;

  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: "text",
    content,
    meta_message_id: metaId,
    chatwoot_message_id: (p.id as number) ?? null,
    status: res.ok ? "sent" : "failed",
  });

  if (conv && !conv.first_response_at) {
    await db.from("conversations").update({ first_response_at: new Date().toISOString() }).eq("id", conv.id);
  }
}
