import { confereSegredoDaFamilia, tokenInformado } from "../shared/segredo-bridge.ts";
import { pumpFunnelQueue } from "../shared/funnel-queue.ts";
import { dispatchDeferredFunnelIntent } from "./hub-webhook.ts";

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!confereSegredoDaFamilia(tokenInformado(req), "envio", "funil-queue-pump")) {
    return json({ error: "unauthorized" }, 401);
  }
  try {
    return json({
      ok: true,
      result: await pumpFunnelQueue(10, dispatchDeferredFunnelIntent),
    });
  } catch (error) {
    return json({ ok: false, error: String(error instanceof Error ? error.message : error) }, 500);
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
