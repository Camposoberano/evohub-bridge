// Ponte EVO Hub <-> Chatwoot — servidor HTTP único (container Deno, deploy via Coolify).
// Rotas:
//   POST /hub-webhook        webhooks do EVO Hub (Meta -> Chatwoot + Postgres)
//   POST /chatwoot-webhook   webhooks do Chatwoot (saída -> /meta/*)
//   POST /connect-channel    botão do dashboard (cria canal + inbox + mapa)
//   GET  /sync-facebook      fallback por pull para Messenger/Instagram (cron)
//   POST /metrics-rollup     rollup diário (agendado)
//   POST /llm-orchestrate    roteamento e persistência de tentativas multi-LLM
//   GET  /health             health-check
import { handle as hubWebhook } from "./handlers/hub-webhook.ts";
import { handle as chatwootWebhook } from "./handlers/chatwoot-webhook.ts";
import { handle as connectChannel } from "./handlers/connect-channel.ts";
import { handle as conversationOutcome } from "./handlers/conversation-outcome.ts";
import { handle as channelHealth } from "./handlers/channel-health.ts";
import { handle as mediaRetention } from "./handlers/media-retention.ts";
import { handle as uazapi } from "./handlers/uazapi.ts";
import { handle as uazapiWebhook } from "./handlers/uazapi-webhook.ts";
import { handle as metaTemplates } from "./handlers/meta-templates.ts";
import { handle as campaign } from "./handlers/campaign.ts";
import { handle as syncFacebook } from "./handlers/sync-facebook.ts";
import { handle as metricsRollup } from "./handlers/metrics-rollup.ts";
import { handle as llmOrchestrate } from "./handlers/llm-orchestrate.ts";
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
  "/conversation-outcome": conversationOutcome,
  "/channel-health": channelHealth,
  "/media-retention": mediaRetention,
  "/uazapi": uazapi,
  "/uazapi-webhook": uazapiWebhook,
  "/meta-templates": metaTemplates,
  "/campaign": campaign,
  "/sync-facebook": syncFacebook,
  "/metrics-rollup": metricsRollup,
  "/llm-orchestrate": llmOrchestrate,
};

const port = Number(Deno.env.get("PORT") ?? "8000");
const version = {
  app: "evohub-bridge",
  features: [
    "sync-facebook",
    "sync-instagram",
    "auto-sync-loop",
    "whatsapp-media",
    "wa-media-graph-direct",
    "llm-orchestrate-v1",
    "conversation-outcome",
    "channel-health",
    "wa-status-capture",
    "media-retention",
    "uazapi",
    "rollup-loop",
    "media-retention-bucket",
    "meta-templates",
    "campaign-gated",
    "outbound-media-caption-fix",
    "template-header-media",
    "audio-ptt-ogg",
    "message-echoes-coexistence",
    "echo-no-resend-loop",
    "native-inbox-headless",
    "template-from-chat",
    "debug-audio",
    "ffmpeg-ld-fix",
  ],
  build: "2026-06-15-ffmpeg-ldfix",
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

// Rollup diário de daily_metrics — loop interno (sem cron externo). Roda a cada 24h
// (dia anterior) + uma vez ~1min após subir, pra começar a preencher o histórico.
const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
function startRollupLoop() {
  const run = async () => {
    try {
      const res = await metricsRollup(new Request("http://internal/metrics-rollup"));
      console.log("metrics-rollup (auto):", JSON.stringify(await res.json()));
    } catch (e) {
      console.error("metrics-rollup (auto) erro:", e);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, ROLLUP_INTERVAL_MS);
}

// Retenção de mídia — loop diário. Dry-run por padrão (só conta); apaga de verdade
// se MEDIA_RETENTION_ENABLED=true. Usa o token de cron interno.
function startRetentionLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/media-retention?token=${encodeURIComponent(token)}`;
  const run = async () => {
    try {
      const res = await mediaRetention(new Request(url));
      const body = await res.json();
      if (body.expired > 0 || body.removed > 0) console.log("media-retention (auto):", JSON.stringify(body));
    } catch (e) {
      console.error("media-retention (auto) erro:", e);
    }
  };
  setTimeout(run, 120_000);
  setInterval(run, 24 * 60 * 60 * 1000);
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
  // diagnóstico temporário do transcode de áudio (PTT). Remover depois.
  if (pathname === "/debug-audio") {
    const out: Record<string, unknown> = {};
    try {
      const c = new Deno.Command("ffmpeg", { args: ["-version"], stdout: "piped", stderr: "piped" });
      const r = await c.output();
      out.ffmpeg = r.success ? new TextDecoder().decode(r.stdout).split("\n")[0] : `FAIL code ${r.code}`;
    } catch (e) { out.ffmpeg = "ERR " + String(e).slice(0, 200); }
    const testUrl = new URL(req.url).searchParams.get("url");
    if (testUrl) {
      try {
        const { toVoiceOgg } = await import("./shared/audio.ts");
        out.transcode = (await toVoiceOgg(testUrl)) ?? "NULL (falhou)";
      } catch (e) { out.transcode = "ERR " + String(e).slice(0, 300); }
    }
    return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
  }

  const h = routes[pathname];
  if (!h) return new Response("not found", { status: 404 });

  const res = await h(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

startSyncLoop();
startRollupLoop();
startRetentionLoop();
console.log(`bridge ouvindo na porta ${port}`);
