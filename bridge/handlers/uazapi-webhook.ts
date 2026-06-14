// uazapi-webhook — recebe eventos do uazapi e grava em events (source=uazapi).
// Alimenta o monitor de eventos do painel. Auth: ?token=<UAZAPI_WEBHOOK_TOKEN|CHATWOOT_WEBHOOK_SECRET>.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const expected = optionalEnv("UAZAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
  if (!timingSafeEqual(token, expected)) return new Response("unauthorized", { status: 401 });

  let p: Json;
  try { p = await req.json(); } catch { return new Response("bad json", { status: 400 }); }

  const eventType = (p.event as string) ?? (p.type as string) ?? (p.EventType as string) ?? "uazapi_event";
  try {
    await admin().from("events").insert({ source: "uazapi", event_type: eventType, payload: p });
  } catch (e) {
    console.error("uazapi-webhook erro:", e);
  }
  return new Response("ok", { status: 200 });
}
