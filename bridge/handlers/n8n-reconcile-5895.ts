import { optionalEnv } from "../shared/env.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { isWithinFunnelSendHours } from "../shared/business-hours.ts";
import { reconcile5895Uncertain } from "../shared/reconcile-5895.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const secret = optionalEnv("N8N_ACTION_SECRET");
  if (!secret) return json({ ok: false, error: "not_configured" }, 503);
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length) : "";
  if (!confereSegredo(token, [secret], "n8n-reconcile-5895")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!isWithinFunnelSendHours()) {
    return json({ ok: true, skipped: "outside_send_window" });
  }
  try {
    const summary = await reconcile5895Uncertain();
    return json({ ok: summary.unresolved === 0, ...summary },
      summary.unresolved === 0 ? 200 : 503);
  } catch (error) {
    console.error("n8n-reconcile-5895:", error instanceof Error ? error.name : "unknown");
    return json({ ok: false, error: "reconciliation_unavailable" }, 503);
  }
}
