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
import { handle as ryzeapiWebhook } from "./handlers/ryzeapi-webhook.ts";
import { handle as ryzeapi } from "./handlers/ryzeapi.ts";
import { handle as sendOutbound } from "./handlers/send-outbound.ts";
import { handle as funilEnroll } from "./handlers/funil-enroll.ts";
import { handle as metaTemplates } from "./handlers/meta-templates.ts";
import { handle as campaign } from "./handlers/campaign.ts";
import { handle as chatwootAccounts } from "./handlers/chatwoot-accounts.ts";
import { handle as channelSync, syncChannels } from "./handlers/channel-sync.ts";
import { handle as clientes } from "./handlers/clientes.ts";
import { handle as syncFacebook } from "./handlers/sync-facebook.ts";
import { handle as syncComments } from "./handlers/sync-comments.ts";
import { handle as syncChatwootOut } from "./handlers/sync-chatwoot-out.ts";
import { handle as labelWindow } from "./handlers/label-window.ts";
import { handle as metricsRollup } from "./handlers/metrics-rollup.ts";
import { handle as llmOrchestrate } from "./handlers/llm-orchestrate.ts";
import { handle as relatorio } from "./handlers/relatorio.ts";
import { handle as hybridRoutes } from "./handlers/hybrid-routes.ts";
import { env, optionalEnv } from "./shared/env.ts";
import { admin } from "./shared/supabase.ts";
import { tokenForInstance, uazapiConfigured } from "./shared/uazapi.ts";
import { enrichStep } from "./shared/enrich.ts";
import { avatarStep } from "./shared/avatar-sync.ts";

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
  "/ryzeapi-webhook": ryzeapiWebhook,
  "/ryzeapi": ryzeapi,
  "/send-outbound": sendOutbound,
  "/funil-enroll": funilEnroll,
  "/meta-templates": metaTemplates,
  "/campaign": campaign,
  "/chatwoot-accounts": chatwootAccounts,
  "/channel-sync": channelSync,
  "/clientes": clientes,
  "/sync-facebook": syncFacebook,
  "/sync-comments": syncComments,
  "/sync-chatwoot-out": syncChatwootOut,
  "/label-window": labelWindow,
  "/metrics-rollup": metricsRollup,
  "/llm-orchestrate": llmOrchestrate,
  "/relatorio": relatorio,
  "/hybrid-routes": hybridRoutes,
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
    
    "ffmpeg-ld-fix",
    "multi-account-chatwoot",
    "fb-sync-cursor",
    "label-window",
    "funil-v2",
    "list-type",
    "menu-acao",
    "text-sequence-pacing",
    "button-title-fix",
    "fase-ordem-imagem-legenda",
    "logo-fixa-fase1",
    "offsets-anti-batch-cron",
    "imagem-botao-combinados",
    "ryzeapi-payload-fix",
    "ryzeapi-painel",
    "ryzeapi-inbound-acct",
    "ryzeapi-outbound-bridge",
    "ryzeapi-inbox-webhook-repoint",
    "ryzeapi-outbound-no-channel-secret",
    "funil-fase1-sem-imagem-solta",
    "funil-fase4-botao-imagem",
    "funil-enroll-force-token",
    "anti-dup-lista-interativo",
    "funil-audio-ptt-ogg",
    "funil-fast-test-mode",
    "funil-turbo-test-mode",
    "funil-audio-media-id-ptt",
    "funil-clique-nao-trava",
    "funil-auto-enroll",
    "funil-send-failed-log",
    "funil-keyword-sem-acento",
    "sync-comments-fb-ig",
    "avatar-sync-uazapi",
    "janela-72h-ctwa",
    "gate-pre-envio-nota-privada",
    "pricing-category-capture",
    "bsuid-proof-inbound",
    "intent-preco-texto-audio",
    "preco-sequencia-v2",
    "preco-v3-area-primeiro",
    "preco-v4-anti-dup-pagamento",
    "preco-v4-1-pagamento-cartao-boleto",
    "preco-v5-imagem-por-pacote",
    "video-sequence-5-videos",
    "plantio-pdf-resumos-lista",
    "nutricao-bromatologica-lista",
    "data-cleanup-30d",
    "comment-reply-fase2",
    "hybrid-routes-uazapi",
  ],
  build: "2026-07-06-hybrid-routes",
};

// Instagram não entrega webhook de mensagens (Meta/Hub só manda object=page para
// Messenger). /sync-facebook é o único caminho de entrada pro IG, então roda em loop
// interno aqui — sem depender de cron externo no Coolify. Pra Facebook é só redundância
// (a entrada já chega por webhook); duplicados são ignorados pelo dedup do próprio sync.
const SYNC_LOOP_INTERVAL_MS = 30_000;
function startSyncLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  // since_minutes curto (10min) descartava pra sempre msg de conversa parada antes da Graph
  // entregar webhook (sem cursor persistente). Dedup é por meta_message_id, então janela
  // larga não duplica nada -- só evita descarte. 1440 (24h) cobre qualquer gap/instabilidade.
  const url = `http://internal/sync-facebook?token=${encodeURIComponent(token)}&since_minutes=1440`;

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

// Comentários de posts/anúncios (FB Pages + Instagram) — Meta não manda webhook de comentário
// pelo Hub, então é pull (Graph) a cada 5min. Cada comentário vira conversa no Chatwoot
// (contato cmt-fb-*/cmt-ig-*). Kill-switch: COMMENTS_SYNC_ENABLED=false.
const COMMENTS_INTERVAL_MS = 5 * 60_000;
function startCommentsLoop() {
  if (optionalEnv("COMMENTS_SYNC_ENABLED") === "false") return; // ligado por padrão
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/sync-comments?token=${encodeURIComponent(token)}&since_minutes=1440`;
  const run = async () => {
    try {
      const res = await syncComments(new Request(url));
      const body = await res.json();
      if (body.inserted > 0 || body.errors?.length) console.log("sync-comments (auto):", JSON.stringify(body));
    } catch (e) {
      console.error("sync-comments (auto) erro:", e);
    }
  };
  setTimeout(run, 90_000);
  setInterval(run, COMMENTS_INTERVAL_MS);
}

// Saída do WhatsApp por PULL — fallback pro webhook do Chatwoot quando ele para de
// disparar (Sidekiq travado / webhook pausado por downtime). Varre conversas WhatsApp e
// entrega as msgs de saída pendentes. Idempotente (claim cw-out-<id> impede duplicar com
// o webhook). Curto (20s) pra latência baixa do atendimento.
const SYNC_OUT_INTERVAL_MS = 20_000;
function startChatwootOutLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/sync-chatwoot-out?token=${encodeURIComponent(token)}&since_minutes=30`;
  setInterval(async () => {
    try {
      const res = await syncChatwootOut(new Request(url));
      const body = await res.json();
      if (body.dispatched > 0 || body.errors?.length) console.log("sync-chatwoot-out (auto):", JSON.stringify(body));
    } catch (e) {
      console.error("sync-chatwoot-out (auto) erro:", e);
    }
  }, SYNC_OUT_INTERVAL_MS);
}

// Etiqueta de janela 24h por conversa (WA/FB/IG) — sem isso o atendente não sabe na tela
// quem pode receber texto livre e quem só com template/dentro do prazo. 5min é granularidade
// suficiente (o aviso "fechando" já dá 1h de antecedência).
const LABEL_WINDOW_INTERVAL_MS = 5 * 60_000;
function startLabelWindowLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/label-window?token=${encodeURIComponent(token)}`;
  setInterval(async () => {
    try {
      const res = await labelWindow(new Request(url));
      const body = await res.json();
      if (body.labeled > 0 || body.errors?.length) console.log("label-window (auto):", JSON.stringify(body));
    } catch (e) {
      console.error("label-window (auto) erro:", e);
    }
  }, LABEL_WINDOW_INTERVAL_MS);
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

// Enriquecimento de clientes (uazapi) — loop sempre-on, resumível. Só roda se
// ENRICH_ENABLED=true + ENRICH_INSTANCE=<nome da instância uazapi de trabalho>.
// Ritmo: 1 passo por ENRICH_INTERVAL_MS (default 10s) -> check em lote, depois details 1 a 1.
function startEnrichLoop() {
  if (optionalEnv("ENRICH_ENABLED") === "false") return; // ligado por padrão; kill-switch = false
  const instName = optionalEnv("ENRICH_INSTANCE") ?? "0595"; // chip de trabalho default
  if (!instName || !uazapiConfigured()) { console.warn("enrich: faltou ENRICH_INSTANCE/uazapi"); return; }
  // Delay ROTACIONA aleatoriamente entre min e max (mais humano, anti-ban). Compat: se só
  // ENRICH_INTERVAL_MS estiver setado, usa ele como min e max (fixo).
  const min = Number(optionalEnv("ENRICH_MIN_MS") ?? optionalEnv("ENRICH_INTERVAL_MS") ?? "40000");
  const max = Number(optionalEnv("ENRICH_MAX_MS") ?? optionalEnv("ENRICH_INTERVAL_MS") ?? "60000");
  let tok = "";
  const tick = async () => {
    try {
      if (!tok) tok = (await tokenForInstance(instName)) ?? "";
      if (tok) { const res = await enrichStep(admin(), tok); if (res !== "idle") console.log("enrich:", res); }
      else console.warn("enrich: instância não encontrada", instName);
    } catch (e) { console.error("enrich erro:", e); }
    const delay = min + Math.floor(Math.random() * Math.max(1, max - min + 1));
    setTimeout(tick, delay);
  };
  setTimeout(tick, 5000);
  console.log(`enrich loop ON (instância=${instName}, ${min}-${max}ms rotacionando)`);
}

// Avatar dos contatos — a API oficial Meta não expõe foto de perfil; a instância uazapi de
// trabalho (mesma do enrich) consulta a foto de qualquer número e o loop grava no Chatwoot.
// 1 contato por tick, 60-90s aleatório (anti-ban). Kill-switch: AVATAR_SYNC_ENABLED=false.
function startAvatarLoop() {
  if (optionalEnv("AVATAR_SYNC_ENABLED") === "false") return; // ligado por padrão
  const instName = optionalEnv("ENRICH_INSTANCE") ?? "0595";
  if (!uazapiConfigured()) { console.warn("avatar-sync: uazapi não configurado"); return; }
  let tok = "";
  const tick = async () => {
    try {
      if (!tok) tok = (await tokenForInstance(instName)) ?? "";
      if (tok) { const r = await avatarStep(admin(), tok); if (r !== "idle") console.log("avatar-sync:", r); }
      else console.warn("avatar-sync: instância não encontrada", instName);
    } catch (e) { console.error("avatar-sync erro:", e); }
    const delay = 60_000 + Math.floor(Math.random() * 30_000);
    setTimeout(tick, delay);
  };
  setTimeout(tick, 30_000);
  console.log(`avatar-sync loop ON (instância=${instName})`);
}

// Limpeza de events e deliveries antigos (>30 dias). Roda 1x/dia, 3min após subir.
function startDataCleanupLoop() {
  const run = async () => {
    const db = admin();
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    try {
      const { count: evDel } = await db.from("events").delete({ count: "exact" }).lt("received_at", cutoff);
      const { count: dlDel } = await db.from("deliveries").delete({ count: "exact" }).lt("received_at", cutoff);
      if ((evDel ?? 0) > 0 || (dlDel ?? 0) > 0) console.log(`data-cleanup: events=${evDel} deliveries=${dlDel} (antes de ${cutoff.slice(0, 10)})`);
    } catch (e) { console.error("data-cleanup erro:", e); }
  };
  setTimeout(run, 180_000);
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
  const h = routes[pathname];
  if (!h) return new Response("not found", { status: 404 });

  const res = await h(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
});

// Sync de status dos canais oficiais (Hub -> base) a cada 5 min: pending->active quando
// conecta, detecta queda. Complementa o webhook channel_connected (que pode falhar).
function startChannelSyncLoop() {
  const run = async () => {
    try { const r = await syncChannels(admin()); if (r.updated) console.log("channel-sync:", JSON.stringify(r)); }
    catch (e) { console.error("channel-sync erro:", e); }
  };
  setTimeout(run, 45_000);
  setInterval(run, 5 * 60 * 1000);
}

startSyncLoop();
startCommentsLoop();
startAvatarLoop();
startChatwootOutLoop();
startLabelWindowLoop();
startRollupLoop();
startRetentionLoop();
startEnrichLoop();
startChannelSyncLoop();
startDataCleanupLoop();
console.log(`bridge ouvindo na porta ${port}`);
