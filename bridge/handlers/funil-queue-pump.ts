import { env } from "../shared/env.ts";
import { pumpFunnelQueue } from "../shared/funnel-queue.ts";

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (token !== env("CHATWOOT_WEBHOOK_SECRET")) return json({ error: "unauthorized" }, 401);
  try {
    return json({ ok: true, result: await pumpFunnelQueue(10) });
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
