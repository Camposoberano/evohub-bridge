// grafana-alert — recebe o webhook de alerta do Alertmanager (ou do contact-point webhook
// do Grafana) e manda um resumo por WhatsApp pro ALERT_WHATSAPP_TO, reusando o canal de
// alerta operacional (ver shared/operational-alert.ts). Fecha o gap "VPS caiu / disco cheio"
// -> WhatsApp sem depender de Discord/Resend.
//
// Payload do Alertmanager v4 (e do Grafana unified, que é compatível):
//   { "status": "firing"|"resolved",
//     "alerts": [{ "status", "labels": { "alertname", "instance", "severity", ... },
//                  "annotations": { "summary", "description" }, "valueString"? }],
//     "commonLabels", "title"?, "message"? }
//
// Auth: Bearer GRAFANA_ALERT_SECRET (ou, se ausente, reaproveita AI_GATE_SECRET) ou ?token=.
import { admin } from "../shared/supabase.ts";
import { optionalEnv } from "../shared/env.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { enviarTextoAlerta } from "../shared/operational-alert.ts";

type Json = Record<string, unknown>;

function tokenFromRequest(req: Request, url: URL): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return url.searchParams.get("token") ?? "";
}

function formatar(p: Json): string {
  const status = String(p.status ?? "").toLowerCase() === "resolved"
    ? "✅ *RESOLVIDO*"
    : "🚨 *DISPARANDO*";
  const alerts = Array.isArray(p.alerts) ? (p.alerts as Json[]) : [];
  const linhas = alerts.slice(0, 10).map((a) => {
    const labels = (a?.labels ?? {}) as Json;
    const ann = (a?.annotations ?? {}) as Json;
    const nome = String(labels.alertname ?? "alerta");
    const inst = String(labels.instance ?? labels.servidor ?? "");
    const resumo = String(ann.summary ?? ann.description ?? "");
    const sev = String(labels.severity ?? "");
    return `• *${nome}*${sev ? ` [${sev}]` : ""}${inst ? ` (${inst})` : ""}${
      resumo ? ` — ${resumo}` : ""
    }`;
  });
  const hora = new Date().toISOString().slice(11, 16);
  return [
    `${status} — *Grafana / VPS soberano* (${hora} UTC)`,
    "",
    ...(linhas.length ? linhas : ["• (alerta sem detalhe)"]),
  ].join("\n");
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const url = new URL(req.url);
  const expected = optionalEnv("GRAFANA_ALERT_SECRET") ?? optionalEnv("AI_GATE_SECRET");
  const token = tokenFromRequest(req, url);
  if (!expected || !confereSegredo(token, [expected], "grafana-alert")) {
    return new Response("unauthorized", { status: 401 });
  }

  let p: Json;
  try {
    p = await req.json();
  } catch {
    p = {};
  }

  try {
    const r = await enviarTextoAlerta(admin(), formatar(p));
    return Response.json({ enviado: r.enviado, motivo: r.motivo });
  } catch (e) {
    console.error("grafana-alert erro:", e);
    return new Response("error", { status: 500 });
  }
}
