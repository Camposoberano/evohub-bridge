// Ponte EVO Hub <-> Chatwoot — servidor HTTP único (container Deno, deploy via Coolify).
// Rotas:
//   POST /hub-webhook        webhooks do EVO Hub (Meta -> Chatwoot + Postgres)
//   POST /chatwoot-webhook   webhooks do Chatwoot (saída -> /meta/*)
//   POST /connect-channel    botão do dashboard (cria canal + inbox + mapa)
//   GET  /sync-facebook      fallback por pull para Messenger/Instagram (cron)
//   POST /metrics-rollup     rollup diário (agendado)
//   GET  /health             health-check
import { handle as hubWebhook } from "./handlers/hub-webhook.ts";
import { handle as chatwootWebhook } from "./handlers/chatwoot-webhook.ts";
import { handle as connectChannel } from "./handlers/connect-channel.ts";
import { handle as syncFacebook } from "./handlers/sync-facebook.ts";
import { handle as metricsRollup } from "./handlers/metrics-rollup.ts";
import { env, optionalEnv } from "./shared/env.ts";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const routes: Record<string, (req: Request) => Promise<Response>> = {
  "/hub-webhook": hubWebhook,
  "/chatwoot-webhook": chatwootWebhook,
  "/connect-channel": connectChannel,
  "/sync-facebook": syncFacebook,
  "/metrics-rollup": metricsRollup,
};

const port = Number(Deno.env.get("PORT") ?? "8000");
const version = {
  app: "evohub-bridge",
  features: ["sync-facebook", "sync-instagram", "auto-sync-loop", "whatsapp-media", "wa-media-graph-direct"],
  build: "2026-06-13-wa-media-graph-direct",
};

// Instagram não entrega webhook de mensagens (Meta/Hub só manda object=page para
// Messenger). /sync-facebook é o único caminho de entrada pro IG, então roda em loop
// interno aqui — sem depender de cron externo no Coolify. Pra Facebook é só redundância
// (a entrada já chega por webhook); duplicados são ignorados pelo dedup do próprio sync.
const SYNC_LOOP_INTERVAL_MS = 30_000;
function startSyncLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/sync-facebook?token=${encodeURIComponent(token)}&since_minutes=10`;

  setInterval(async () => {
    try {
      const res = await syncFacebook(new Request(url));
      const body = await res.json();
      if (body.errors?.length || body.inserted > 0 || body.outgoing_sent > 0 || body.media_repaired > 0) {
        console.log("sync-facebook (auto):", JSON.stringify(body));
      }
    } catch (e) {
      console.error("sync-facebook (auto) erro:", e);
    }
  }, SYNC_LOOP_INTERVAL_MS);
}

Deno.serve({ port }, async (req) => {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (pathname === "/health") return new Response("ok");
  if (pathname === "/version") {
    return new Response(JSON.stringify(version), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const h = routes[pathname];
  if (!h) return new Response("not found", { status: 404 });

  const res = await h(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

startSyncLoop();
console.log(`bridge ouvindo na porta ${port}`);
