// ryzeapi-webhook — recebe eventos da RyzeAPI (teste/avaliação, provedor alternativo de
// WhatsApp não-oficial). A ponte nativa Chatwoot deles funciona bem pra SAÍDA, mas não cria
// conversa pra mensagens de ENTRADA de forma confiável (bug observado, achado testando) --
// por isso processamos a entrada por aqui, com ingestInbound() (mesma função usada pro Hub
// oficial), em vez de depender da ponte deles. Saída continua pela ponte nativa deles.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { ingestInbound } from "../shared/inbound.ts";

type Json = Record<string, unknown>;

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

  await ingestInbound(db, channel as Json, {
    from,
    name: (chat.name as string) || (sender.name as string) || undefined,
    metaMessageId: messageId,
    msgType,
    content,
    sentAt: data.timestamp as string | undefined,
  });
}
