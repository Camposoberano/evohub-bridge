// ryzeapi-webhook — recebe eventos da RyzeAPI (teste/avaliação, instância "mato grosso").
// Por enquanto só LOGA em events (source=ryzeapi) -- a ponte nativa Chatwoot deles já
// manda outbound certo; o problema é inbound de contato @lid não criar conversa no Chatwoot.
// Logamos o payload bruto pra confirmar se "chat.jid" vem com telefone real ou só @lid
// antes de decidir se dá pra resolver e completar a ponte do nosso lado.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";

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
  try {
    await admin().from("events").insert({ source: "ryzeapi", event_type: eventType, payload: p });
  } catch (e) {
    console.error("ryzeapi-webhook erro:", e);
  }
  return new Response("ok", { status: 200 });
}
