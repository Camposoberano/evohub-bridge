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
import {
  handle as funilEnroll,
  recoverEligibleFunnels,
} from "./handlers/funil-enroll.ts";
import {
  dispatchRecovery,
  handle as funilControl,
} from "./handlers/funil-control.ts";
import { pumpRecoveryChain } from "./shared/recovery-chain.ts";
import { accountForChannel } from "./shared/accounts.ts";
import { handle as metaTemplates } from "./handlers/meta-templates.ts";
import { handle as campaign } from "./handlers/campaign.ts";
import { handle as chatwootAccounts } from "./handlers/chatwoot-accounts.ts";
import {
  handle as channelSync,
  syncChannels,
} from "./handlers/channel-sync.ts";
import { handle as clientes } from "./handlers/clientes.ts";
import { handle as syncFacebook } from "./handlers/sync-facebook.ts";
import { handle as syncComments } from "./handlers/sync-comments.ts";
import { handle as syncChatwootOut } from "./handlers/sync-chatwoot-out.ts";
import {
  readSyncOutState,
  syncOutSinceMinutes,
  writeSyncOutState,
} from "./shared/sync-out-state.ts";
import { handle as labelWindow } from "./handlers/label-window.ts";
import { handle as syncLabels } from "./handlers/sync-labels.ts";
import { handle as syncWaLabels } from "./handlers/sync-wa-labels.ts";
import { handle as metricsRollup } from "./handlers/metrics-rollup.ts";
import { handle as llmOrchestrate } from "./handlers/llm-orchestrate.ts";
import { handle as relatorio } from "./handlers/relatorio.ts";
import { handle as hybridRoutes } from "./handlers/hybrid-routes.ts";
import { handle as hybridOps } from "./handlers/hybrid-ops.ts";
import { handle as funnelOps } from "./handlers/funnel-ops.ts";
import { handle as repairOfficial5895 } from "./handlers/repair-official-5895.ts";
import { handle as funnelQueuePump } from "./handlers/funil-queue-pump.ts";
import {
  handle as operationalHealth,
  runOperationalAudit,
} from "./handlers/operational-health.ts";
import { env, optionalEnv } from "./shared/env.ts";
import { timingSafeEqual } from "./shared/hmac.ts";
import { agendarLoop } from "./shared/loop-guard.ts";
import { admin, claimDelivery, releaseDelivery } from "./shared/supabase.ts";
import { tokenForInstance, uazapiConfigured } from "./shared/uazapi.ts";
import { enrichStep } from "./shared/enrich.ts";
import { avatarStep } from "./shared/avatar-sync.ts";
import {
  envAcct,
  getConversationLabels,
  setConversationLabels,
} from "./shared/chatwoot.ts";
import { pumpFunnelQueue } from "./shared/funnel-queue.ts";
import {
  maintainFunnels,
  resumeSequenceRebased,
} from "./shared/funnel-recovery.ts";
import { BOT_MUTE_LABEL, reconcileBotMute } from "./shared/bot-mute.ts";
import { flowChannelFor, pumpFlowTimeouts } from "./shared/flow-inbound.ts";
import { PACE_PADRAO, podeEnviarAgora } from "./shared/campaign-pace.ts";
import {
  campanhasComFila,
  enviadosHoje,
  marcarEnviado,
  marcarFalha,
  marcarPulado,
  proximoDaFila,
  reservarItem,
  ultimoEnvioAt,
} from "./shared/campaign-queue.ts";
import { runFlow } from "./shared/flow-runner.ts";
import { gravadorDeFluxo } from "./shared/flow-record.ts";
import { saveFlowPosition } from "./shared/flow-state.ts";
import { isBotMutedForContact } from "./shared/bot-mute.ts";
import { readCampaigns } from "./shared/campaigns.ts";
import { runDeclineGuard } from "./shared/decline-guard.ts";

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
  "/funil-control": funilControl,
  "/meta-templates": metaTemplates,
  "/campaign": campaign,
  "/chatwoot-accounts": chatwootAccounts,
  "/channel-sync": channelSync,
  "/clientes": clientes,
  "/sync-facebook": syncFacebook,
  "/sync-comments": syncComments,
  "/sync-chatwoot-out": syncChatwootOut,
  "/label-window": labelWindow,
  "/sync-labels": syncLabels,
  "/sync-wa-labels": syncWaLabels,
  "/metrics-rollup": metricsRollup,
  "/llm-orchestrate": llmOrchestrate,
  "/relatorio": relatorio,
  "/hybrid-routes": hybridRoutes,
  "/hybrid-ops": hybridOps,
  "/funnel-ops": funnelOps,
  "/repair-official-5895": repairOfficial5895,
  "/funil-queue-pump": funnelQueuePump,
  "/operational-health": operationalHealth,
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
    "funil-control-pause-stop-resume",
    "funil-auto-pause-on-intent",
    "funil-command-private-note",
    "macro-command-poll-15s",
    "llm-openai-execute-cache",
    "repair-official-5895-single-inbox",
    "uazapi-device-echo-to-chatwoot",
    "funnel-queue-pump",
    "dashboard-funnel-operations",
    "dashboard-hybrid-channel-control",
    "hybrid-route-observability",
    "funnel-auto-night-6am",
    "funnel-eligible-lead-recovery",
    "price-planting-direct-cta",
    "macro-command-ack-before-consume",
    "meta-message-id-required-for-price",
    "price-natural-area-labels",
    "commercial-intent-once-per-day",
    "commercial-media-delivery-proof",
    "dashboard-commercial-sequences",
    "daily-intent-normalized-contact",
    "persistent-contact-profile-enrichment",
    "funnel-pause-reason-audit",
    "funnel-final-business-hours-gate",
    "dashboard-queue-grouped-by-conversation",
    "social-channel-auth-fallback",
    "facebook-instagram-comment-replies",
    "social-comments-realtime-webhook",
    "social-comment-isolated-conversation",
    "social-webhook-safe-retry",
    "social-outgoing-failure-note",
    "social-comments-pagination",
    "ryze-device-message-direction",
    "social-comment-keyword-autoreply",
    "latest-open-conversation-selection",
    "ryze-failed-ingest-retry",
    "chatwoot-admin-send-fallback",
    "chatwoot-stale-source-incoming-fallback",
    "ryze-private-media-relay",
    "meta-window-terminal-failure",
    "chatwoot-out-5s-single-flight",
    "funnel-silence-followup",
    "funnel-auto-resume-after-intent",
    "funnel-completion-reconciliation",
    "funnel-48h-business-cadence",
    "funnel-business-clock-pause",
    "customer-recovery-macros-v1",
    "customer-recovery-label-tracking",
    "chatwoot-callback-fast-ack",
    "social-funnel-private-messages",
    "social-price-quick-replies",
    "meta-thread-control-terminal-block",
    "social-outgoing-single-claim",
    "social-recovery-and-video-macros",
    "instagram-price-reply-payload-fallback",
    "hybrid-price-button-title-fallback",
    "social-video-sequence-resilient",
    "outbound-full-payload-dedup",
    "facebook-meta-ai-button-prefix",
    "facebook-persistent-postback-buttons",
    "social-price-postback-sync-handoff",
    "outbound-dedup-real-2min-ttl",
    "social-click-scoped-dedup",
    "social-other-area-reply-recognition",
    "social-reply-recent-prompt-search",
    "social-sales-contact-card",
    "social-sales-lead-qualification",
    "social-planting-nutrition-flows",
    "facebook-list-persistent-buttons",
    "instagram-audio-mp3-fallback",
    "audio-transcription-provider-fallback",
    "lead-source-attribution",
    "lead-profile-autocapture",
    "channel-owner-tracking",
    "operational-monitor-7d",
    "catalog-manual-entry-only",
    "catalog-mega-sorgo-journey-isolation",
    "catalog-product-price-source",
    "report-auth-token-or-jwt",
    "msg-type-alias-normalization",
    "outbound-echo-dedup",
    "first-response-trigger",
    "message-funnel-link",
    "outcome-label-pago-nao-compra",
    "completion-labels-by-funnel",
    "funil-fase5-logistica-e-pacote-2kg",
    "recovery-chain-1-2-4-7",
    "recovery-chain-funil-abandonado",
    "version-uptime",
    "social-window-gate-24h",
    "meta-window-403-subcode-2534022",
    "social-token-health-alarm",
    "inbound-claim-release-on-error",
    "inbound-survives-chatwoot-failure",
    "social-attachment-subfields",
    "media-relay-retry-404",
    "ig-attachment-hub-auth",
    "ig-share-link-inbound",
    "operational-alert-delivery",
    "monitor-token-silence-inbound-loss",
    "internal-number-no-automation",
  ],
  build: "2026-08-30-ssrf-relay-midia",
};

// Momento em que ESTE processo subiu. `build` e `features` são escritos à mão e não mudam
// quando o commit só mexe em lógica — foi o que aconteceu em 04/08: três correções no ar
// e nenhum jeito de confirmar de fora se o deploy pegou. Uptime baixo prova container novo.
const STARTED_AT = new Date().toISOString();

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
  const url = `http://internal/sync-facebook?token=${
    encodeURIComponent(token)
  }&since_minutes=1440`;

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const res = await syncFacebook(new Request(url));
      const body = await res.json();
      if (
        body.errors?.length || body.inserted > 0 || body.outgoing_sent > 0 ||
        body.media_repaired > 0
      ) {
        console.log("sync-facebook (auto):", JSON.stringify(body));
      }
    } catch (e) {
      console.error("sync-facebook (auto) erro:", e);
    } finally {
      running = false;
    }
  }, SYNC_LOOP_INTERVAL_MS);
}

// Comentários de posts/anúncios (FB Pages + Instagram) — fallback por pull (Graph) a cada
// 5min para cobrir atraso ou ausência de entrega do webhook pelo Hub. Cada comentário vira conversa no Chatwoot
// (contato cmt-fb-*/cmt-ig-*). Kill-switch: COMMENTS_SYNC_ENABLED=false.
const COMMENTS_INTERVAL_MS = 5 * 60_000;
function startCommentsLoop() {
  if (optionalEnv("COMMENTS_SYNC_ENABLED") === "false") return; // ligado por padrão
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/sync-comments?token=${
    encodeURIComponent(token)
  }&since_minutes=1440`;
  const run = async () => {
    try {
      const res = await syncComments(new Request(url));
      const body = await res.json();
      if (body.inserted > 0 || body.errors?.length) {
        console.log("sync-comments (auto):", JSON.stringify(body));
      }
    } catch (e) {
      console.error("sync-comments (auto) erro:", e);
    }
  };
  agendarLoop("comments", run, {
    intervaloMs: COMMENTS_INTERVAL_MS,
    primeiraEmMs: 90_000,
  });
}

// Saída do WhatsApp por PULL — fallback pro webhook do Chatwoot quando ele para de
// disparar (Sidekiq travado / webhook pausado por downtime). O webhook continua sendo a
// via imediata; o pull normal usa janela curta para não reler meia hora de conversas a cada
// poucos segundos. Na partida e depois de erro, uma rodada recupera os mesmos 30min que o
// comportamento anterior cobria.
const SYNC_OUT_INTERVAL_MS = boundedEnvInt(
  "SYNC_OUT_POLL_INTERVAL_MS",
  30_000,
  5_000,
  5 * 60_000,
);
const SYNC_OUT_STEADY_SINCE_MINUTES = boundedEnvInt(
  "SYNC_OUT_STEADY_SINCE_MINUTES",
  2,
  1,
  30,
);
const SYNC_OUT_STARTUP_SINCE_MINUTES = boundedEnvInt(
  "SYNC_OUT_STARTUP_SINCE_MINUTES",
  30,
  1,
  1440,
);
function startChatwootOutLoop() {
  if (optionalEnv("SYNC_OUT_ENABLED") === "false") {
    console.log("sync-chatwoot-out loop OFF (SYNC_OUT_ENABLED=false)");
    return;
  }
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  let running = false;
  let forceRecovery = false;
  let lastSuccessfulAt: string | null = null;
  const run = async () => {
    if (running) return;
    running = true;
    const sinceMinutes = forceRecovery
      ? SYNC_OUT_STARTUP_SINCE_MINUTES
      : syncOutSinceMinutes(
        lastSuccessfulAt,
        SYNC_OUT_STEADY_SINCE_MINUTES,
        SYNC_OUT_STARTUP_SINCE_MINUTES,
      );
    const mode = sinceMinutes > SYNC_OUT_STEADY_SINCE_MINUTES
      ? "recovery"
      : "steady";
    try {
      const url = `http://internal/sync-chatwoot-out?token=${
        encodeURIComponent(token)
      }&since_minutes=${sinceMinutes}`;
      const res = await syncChatwootOut(new Request(url));
      const body = await res.json();
      if (res.ok) {
        lastSuccessfulAt = new Date().toISOString();
        forceRecovery = false;
        writeSyncOutState(lastSuccessfulAt).catch((error) =>
          console.error("sync-chatwoot-out state erro:", error)
        );
      } else {
        forceRecovery = true;
      }
      if (body.dispatched > 0 || body.errors?.length) {
        console.log(
          "sync-chatwoot-out (auto):",
          JSON.stringify({ ...body, mode }),
        );
      }
    } catch (e) {
      forceRecovery = true;
      console.error("sync-chatwoot-out (auto) erro:", e);
    } finally {
      running = false;
    }
  };
  readSyncOutState().then((state) => {
    lastSuccessfulAt = state.lastSuccessfulAt ?? null;
    void run();
  }).catch(() => {
    void run();
  });
  setInterval(run, SYNC_OUT_INTERVAL_MS);
  console.log(
    `sync-chatwoot-out loop ON (${SYNC_OUT_INTERVAL_MS}ms, ` +
      `steady=${SYNC_OUT_STEADY_SINCE_MINUTES}min, ` +
      `recovery=${SYNC_OUT_STARTUP_SINCE_MINUTES}min)`,
  );
}

function boundedEnvInt(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(optionalEnv(key) ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

// Etiqueta de janela 24h por conversa (WA/FB/IG) — sem isso o atendente não sabe na tela
// quem pode receber texto livre e quem só com template/dentro do prazo. 5min é granularidade
// suficiente (o aviso "fechando" já dá 1h de antecedência).
const LABEL_WINDOW_INTERVAL_MS = 5 * 60_000;
function startLabelWindowLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/label-window?token=${encodeURIComponent(token)}`;
  const tick = async () => {
    const res = await labelWindow(new Request(url));
    const body = await res.json();
    if (body.labeled > 0 || body.errors?.length) {
      console.log("label-window (auto):", JSON.stringify(body));
    }
  };
  agendarLoop("label-window", tick, { intervaloMs: LABEL_WINDOW_INTERVAL_MS });
}

// Espelha as etiquetas do Chatwoot em conversations.labels e deriva outcome (won/lost).
// O comercial marca venda/não-compra por etiqueta; sem isso o banco fica sem taxa de
// conversão. 10min basta: é dado de análise, não de operação.
// Kill-switch: SYNC_LABELS_ENABLED=false.
const SYNC_LABELS_INTERVAL_MS = 10 * 60_000;
function startSyncLabelsLoop() {
  if (optionalEnv("SYNC_LABELS_ENABLED") === "false") {
    console.log("sync-labels loop OFF (SYNC_LABELS_ENABLED=false)");
    return;
  }
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/sync-labels?token=${encodeURIComponent(token)}`;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const res = await syncLabels(new Request(url));
      const body = await res.json();
      if (
        body.labels_updated > 0 || body.outcome_set > 0 || body.errors?.length
      ) {
        console.log("sync-labels (auto):", JSON.stringify(body));
      }
    } catch (e) {
      console.error("sync-labels (auto) erro:", e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 60_000); // primeira passada ~1min após subir, pra fazer o backfill
  setInterval(tick, SYNC_LABELS_INTERVAL_MS);
}

// Mesmo que o anterior, mas para as etiquetas aplicadas dentro do WhatsApp (uazapi) —
// o time marca "Pago"/"Não COMPRA" por lá, que é mais rápido que abrir o Chatwoot.
// Intervalo maior: /chat/find devolve até 2000 chats por instância, é chamada cara.
// Kill-switch: SYNC_WA_LABELS_ENABLED=false.
const SYNC_WA_LABELS_INTERVAL_MS = 15 * 60_000;
function startSyncWaLabelsLoop() {
  if (optionalEnv("SYNC_WA_LABELS_ENABLED") === "false") {
    console.log("sync-wa-labels loop OFF (SYNC_WA_LABELS_ENABLED=false)");
    return;
  }
  if (!uazapiConfigured()) {
    console.log("sync-wa-labels loop OFF (uazapi não configurado)");
    return;
  }
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/sync-wa-labels?token=${
    encodeURIComponent(token)
  }`;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const res = await syncWaLabels(new Request(url));
      const body = await res.json();
      if (
        body.labels_updated > 0 || body.outcome_set > 0 || body.errors?.length
      ) {
        console.log("sync-wa-labels (auto):", JSON.stringify(body));
      }
    } catch (e) {
      console.error("sync-wa-labels (auto) erro:", e);
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 120_000); // 2min após subir, depois do sync do Chatwoot
  setInterval(tick, SYNC_WA_LABELS_INTERVAL_MS);
}

// Rollup diário de daily_metrics — loop interno (sem cron externo). Roda a cada 24h
// (dia anterior) + uma vez ~1min após subir, pra começar a preencher o histórico.
const ROLLUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
function startRollupLoop() {
  const run = async () => {
    try {
      // /metrics-rollup passou a exigir auth (defeito 9 da auditoria 08/2026) -- o loop
      // interno precisa do mesmo token de cron que os outros loops (ex: startRetentionLoop).
      const token = optionalEnv("SYNC_SECRET") ??
        env("CHATWOOT_WEBHOOK_SECRET");
      const res = await metricsRollup(
        new Request(
          `http://internal/metrics-rollup?token=${encodeURIComponent(token)}`,
        ),
      );
      console.log("metrics-rollup (auto):", JSON.stringify(await res.json()));
    } catch (e) {
      console.error("metrics-rollup (auto) erro:", e);
    }
  };
  agendarLoop("rollup", run, {
    intervaloMs: ROLLUP_INTERVAL_MS,
    primeiraEmMs: 60_000,
  });
}

// Retenção de mídia — loop diário. Dry-run por padrão (só conta); apaga de verdade
// se MEDIA_RETENTION_ENABLED=true. Usa o token de cron interno.
function startRetentionLoop() {
  const token = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  const url = `http://internal/media-retention?token=${
    encodeURIComponent(token)
  }`;
  const run = async () => {
    try {
      const res = await mediaRetention(new Request(url));
      const body = await res.json();
      if (body.expired > 0 || body.removed > 0) {
        console.log("media-retention (auto):", JSON.stringify(body));
      }
    } catch (e) {
      console.error("media-retention (auto) erro:", e);
    }
  };
  agendarLoop("retention", run, {
    intervaloMs: 24 * 60 * 60 * 1000,
    primeiraEmMs: 120_000,
    travaMaximaMs: 2 * 60 * 60_000,
  });
}

// Enriquecimento de clientes (uazapi) — loop sempre-on, resumível. Só roda se
// ENRICH_ENABLED=true + ENRICH_INSTANCE=<nome da instância uazapi de trabalho>.
// Ritmo: 1 passo por ENRICH_INTERVAL_MS (default 10s) -> check em lote, depois details 1 a 1.
function startEnrichLoop() {
  if (optionalEnv("ENRICH_ENABLED") === "false") return; // ligado por padrão; kill-switch = false
  const instName = optionalEnv("ENRICH_INSTANCE") ?? "5895"; // chip de trabalho default
  if (!instName || !uazapiConfigured()) {
    console.warn("enrich: faltou ENRICH_INSTANCE/uazapi");
    return;
  }
  // Delay ROTACIONA aleatoriamente entre min e max (mais humano, anti-ban). Compat: se só
  // ENRICH_INTERVAL_MS estiver setado, usa ele como min e max (fixo).
  const min = Number(
    optionalEnv("ENRICH_MIN_MS") ?? optionalEnv("ENRICH_INTERVAL_MS") ??
      "40000",
  );
  const max = Number(
    optionalEnv("ENRICH_MAX_MS") ?? optionalEnv("ENRICH_INTERVAL_MS") ??
      "60000",
  );
  let tok = "";
  const tick = async () => {
    try {
      if (!tok) tok = (await tokenForInstance(instName)) ?? "";
      if (tok) {
        const res = await enrichStep(admin(), tok);
        if (res !== "idle") console.log("enrich:", res);
      } else console.warn("enrich: instância não encontrada", instName);
    } catch (e) {
      console.error("enrich erro:", e);
    }
    const delay = min + Math.floor(Math.random() * Math.max(1, max - min + 1));
    setTimeout(tick, delay);
  };
  setTimeout(tick, 5000);
  console.log(
    `enrich loop ON (instância=${instName}, ${min}-${max}ms rotacionando)`,
  );
}

// Avatar dos contatos — a API oficial Meta não expõe foto de perfil; a instância uazapi de
// trabalho (mesma do enrich) consulta a foto de qualquer número e o loop grava no Chatwoot.
// 1 contato por tick, 60-90s aleatório (anti-ban). Kill-switch: AVATAR_SYNC_ENABLED=false.
function startAvatarLoop() {
  if (optionalEnv("AVATAR_SYNC_ENABLED") === "false") return; // ligado por padrão
  const instName = optionalEnv("ENRICH_INSTANCE") ?? "5895";
  if (!uazapiConfigured()) {
    console.warn("avatar-sync: uazapi não configurado");
    return;
  }
  let tok = "";
  const tick = async () => {
    try {
      if (!tok) tok = (await tokenForInstance(instName)) ?? "";
      if (tok) {
        const r = await avatarStep(admin(), tok);
        if (r !== "idle") console.log("avatar-sync:", r);
      } else console.warn("avatar-sync: instância não encontrada", instName);
    } catch (e) {
      console.error("avatar-sync erro:", e);
    }
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
      const { count: evDel } = await db.from("events").delete({
        count: "exact",
      }).lt("received_at", cutoff);
      const { count: dlDel } = await db.from("deliveries").delete({
        count: "exact",
      }).lt("received_at", cutoff);
      if ((evDel ?? 0) > 0 || (dlDel ?? 0) > 0) {
        console.log(
          `data-cleanup: events=${evDel} deliveries=${dlDel} (antes de ${
            cutoff.slice(0, 10)
          })`,
        );
      }
    } catch (e) {
      console.error("data-cleanup erro:", e);
    }
  };
  agendarLoop("data-cleanup", run, {
    intervaloMs: 24 * 60 * 60 * 1000,
    primeiraEmMs: 180_000,
    travaMaximaMs: 2 * 60 * 60_000,
  });
}

// Macro commands via labels — Chatwoot macros add labels (cmd-*), mas NÃO disparam
// webhook. Loop poll a cada 15s usa filter API do Chatwoot pra buscar conversas com
// qualquer cmd-* label, executa funil-control e remove a label.
// Kill-switch: MACRO_POLL_ENABLED=false.
const MACRO_POLL_INTERVAL_MS = 15_000;
const CMD_LABELS: Record<string, string> = {
  "cmd-funil-pause": "pause",
  "cmd-funil-stop": "stop",
  "cmd-funil-resume": "resume",
  "cmd-iniciar-funil": "funil",
  "cmd-enviar-preco": "preco",
  "cmd-enviar-video": "video",
  "cmd-enviar-plantio": "plantio",
  "cmd-enviar-nutricao": "nutricao",
  "cmd-recuperar-1": "recuperacao-1",
  "cmd-recuperar-2": "recuperacao-2",
  "cmd-recuperar-3": "recuperacao-3",
  "cmd-recuperar-4": "recuperacao-4",
  "cmd-abrir-catalogo": "catalogo",
  "cmd-voltar-mega-sorgo": "catalogo-sair",
  // Destrava do bot. Entra aqui, e não no loop do bot-off, porque é comando de uma vez
  // (consumido e apagado) e não estado — quem guarda o estado é a etiqueta `bot-off`.
  // A macro "Bot OFF" não precisa de entrada nenhuma: ela só põe a etiqueta de estado.
  "bot-on": "bot-on",
};
const CMD_LABEL_KEYS = Object.keys(CMD_LABELS);

// Payload do filter API — OR de todos os cmd labels.
const CMD_FILTER_PAYLOAD = JSON.stringify({
  payload: CMD_LABEL_KEYS.map((label, i) => ({
    attribute_key: "labels",
    filter_operator: "equal_to",
    values: [label],
    query_operator: i < CMD_LABEL_KEYS.length - 1 ? "OR" : null,
  })),
});

function startMacroCommandLoop() {
  if (optionalEnv("MACRO_POLL_ENABLED") === "false") return;
  const secret = env("CHATWOOT_WEBHOOK_SECRET");
  const acct = envAcct();
  const baseUrl = acct.url.replace(/\/+$/, "");
  const filterUrl =
    `${baseUrl}/api/v1/accounts/${acct.accountId}/conversations/filter`;

  const tick = async () => {
    try {
      const res = await fetch(filterUrl, {
        method: "POST",
        headers: {
          "api_access_token": acct.token,
          "Content-Type": "application/json",
        },
        body: CMD_FILTER_PAYLOAD,
      });
      if (!res.ok) {
        console.warn("macro-poll: filter", res.status);
        return;
      }
      const json = await res.json();
      const convs = (json.payload ?? []) as Array<Record<string, unknown>>;
      if (convs.length === 0) return;
      console.log("macro-poll: found", convs.length, "conv(s) with cmd labels");

      for (const conv of convs) {
        const labels = (conv.labels ?? []) as string[];
        const cmdLabel = labels.find((l) => CMD_LABEL_KEYS.includes(l));
        if (!cmdLabel) continue;
        const cwConvId = conv.id as number;
        const action = CMD_LABELS[cmdLabel];
        console.log("macro-poll:", cmdLabel, "conv", cwConvId, "->", action);

        try {
          const r = await fetch(
            `http://localhost:${port}/funil-control?token=${
              encodeURIComponent(secret)
            }`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action,
                chatwoot_conversation_id: cwConvId,
              }),
            },
          );
          const result = await r.json().catch(() => ({}));
          console.log(
            "macro-poll result:",
            JSON.stringify(result).slice(0, 200),
          );
          if (!r.ok || result.ok !== true) {
            if (result.terminal === true) {
              console.warn(
                "macro-poll: falha terminal, removendo comando",
                cmdLabel,
                "conv",
                cwConvId,
              );
            } else {
              console.warn(
                "macro-poll: comando mantido para nova tentativa",
                cmdLabel,
                "conv",
                cwConvId,
              );
              continue;
            }
          }

          // Só consome a etiqueta depois que o destino confirma a execução.
          // Em falha, ela permanece e o próximo tick tenta novamente.
          try {
            const freshLabels = await getConversationLabels(cwConvId, acct);
            const cleaned = freshLabels.filter((l) =>
              !CMD_LABEL_KEYS.includes(l)
            );
            if (cleaned.length !== freshLabels.length) {
              await setConversationLabels(cwConvId, cleaned, acct);
            }
          } catch (e) {
            console.warn("macro-poll cleanup:", String(e).slice(0, 120));
          }
        } catch (e) {
          console.error("macro-poll exec erro:", e);
        }
      }
    } catch (e) {
      console.error("macro-poll erro:", e);
    }
  };
  agendarLoop("macro-command-poll", tick, {
    intervaloMs: MACRO_POLL_INTERVAL_MS,
    primeiraEmMs: 10_000,
  });
  console.log("macro-command-poll loop ON (15s, filter API)");
}

// Trava do bot (`bot-off`) — terceira família de etiqueta, com regra própria.
//
// Diferente de cmd-* (consumida e apagada) e de pago/nao-compra (persistente, mas ação
// única): esta é persistente E de mão dupla. A etiqueta É o estado, então o que importa
// não é o evento de marcar, é a foto de quem está marcado agora — quem ganhou a etiqueta
// desde o último tick trava, e quem perdeu destrava. Por isso não usa claimDelivery: não
// existe "já processei", existe "o Chatwoot diz que hoje são estas".
//
// Destravar reprograma o funil (resumeSequenceRebased): as peças pausadas ficaram com
// send_at no passado e voltariam todas de uma vez.
// Kill-switch: BOT_MUTE_POLL_ENABLED=false.
const BOT_MUTE_POLL_INTERVAL_MS = 20_000;
const BOT_MUTE_FILTER_PAYLOAD = JSON.stringify({
  payload: [{
    attribute_key: "labels",
    filter_operator: "equal_to",
    values: [BOT_MUTE_LABEL],
    query_operator: null,
  }],
});

function startBotMuteLoop() {
  if (optionalEnv("BOT_MUTE_POLL_ENABLED") === "false") return;
  const acct = envAcct();
  const baseUrl = acct.url.replace(/\/+$/, "");
  const filterUrl =
    `${baseUrl}/api/v1/accounts/${acct.accountId}/conversations/filter`;

  const tick = async () => {
    try {
      const res = await fetch(filterUrl, {
        method: "POST",
        headers: {
          "api_access_token": acct.token,
          "Content-Type": "application/json",
        },
        body: BOT_MUTE_FILTER_PAYLOAD,
      });
      if (!res.ok) {
        // Sem a foto do Chatwoot não dá pra distinguir "ninguém travado" de "não
        // consegui perguntar" — reconciliar com lista vazia destravaria todo mundo.
        console.warn("bot-mute-poll: filter", res.status);
        return;
      }
      const json = await res.json();
      const convs = (json.payload ?? []) as Array<Record<string, unknown>>;
      const cwIds = convs.map((c) => Number(c.id)).filter(Number.isFinite);

      const db = admin();
      const { muted, unmuted } = await reconcileBotMute(db, cwIds);
      if (!muted.length && !unmuted.length) return;
      console.log(
        "bot-mute-poll:",
        JSON.stringify({ travadas: muted.length, destravadas: unmuted.length }),
      );

      for (const conversationId of unmuted) {
        try {
          const retomadas = await resumeSequenceRebased(db, conversationId);
          if (retomadas > 0) {
            await db.from("events").insert({
              source: "funil",
              event_type: "auto_resumed",
              payload: {
                conversation_id: conversationId,
                reason: "bot-off removido",
                resumed_messages: retomadas,
              },
            });
          }
        } catch (e) {
          console.error("bot-mute-poll: retomada falhou", conversationId, e);
        }
      }
    } catch (e) {
      console.error("bot-mute-poll erro:", e);
    }
  };
  agendarLoop("bot-mute-poll", tick, {
    intervaloMs: BOT_MUTE_POLL_INTERVAL_MS,
    primeiraEmMs: 25_000,
  });
  console.log(`bot-mute-poll loop ON (20s, label ${BOT_MUTE_LABEL})`);
}

// Etiquetas de resultado ("pago"/"nao-compra") — diferente do poll de cmd-* acima, essas
// etiquetas são PERSISTENTES (o atendente marca e ela fica visível como status). Por isso
// não removemos a etiqueta depois de rodar; a idempotência vem de um claim em `deliveries`
// (mesmo primitivo usado em toda dedup do bridge) -- ação roda 1x por conversa/etiqueta,
// não a cada tick de 20s. Falha na chamada libera o claim pro próximo tick tentar de novo.
const OUTCOME_LABEL_POLL_INTERVAL_MS = 20_000;
const OUTCOME_LABELS: Record<string, string> = {
  "pago": "marcar-pago",
  "nao-compra": "marcar-nao-compra",
};
const OUTCOME_LABEL_KEYS = Object.keys(OUTCOME_LABELS);
const OUTCOME_FILTER_PAYLOAD = JSON.stringify({
  payload: OUTCOME_LABEL_KEYS.map((label, i) => ({
    attribute_key: "labels",
    filter_operator: "equal_to",
    values: [label],
    query_operator: i < OUTCOME_LABEL_KEYS.length - 1 ? "OR" : null,
  })),
});

function startOutcomeLabelLoop() {
  if (optionalEnv("MACRO_POLL_ENABLED") === "false") return;
  const secret = env("CHATWOOT_WEBHOOK_SECRET");
  const acct = envAcct();
  const baseUrl = acct.url.replace(/\/+$/, "");
  const filterUrl =
    `${baseUrl}/api/v1/accounts/${acct.accountId}/conversations/filter`;
  const db = admin();

  const tick = async () => {
    try {
      const res = await fetch(filterUrl, {
        method: "POST",
        headers: {
          "api_access_token": acct.token,
          "Content-Type": "application/json",
        },
        body: OUTCOME_FILTER_PAYLOAD,
      });
      if (!res.ok) {
        console.warn("outcome-label-poll: filter", res.status);
        return;
      }
      const json = await res.json();
      const convs = (json.payload ?? []) as Array<Record<string, unknown>>;

      for (const conv of convs) {
        const labels = (conv.labels ?? []) as string[];
        const label = labels.find((l) => OUTCOME_LABEL_KEYS.includes(l));
        if (!label) continue;
        const cwConvId = conv.id as number;
        const action = OUTCOME_LABELS[label];
        const claimKey = `outcome-label-${cwConvId}-${label}`;
        // já processado antes -- etiqueta fica visível, mas a ação (cancelar funil, marcar
        // outcome, bloquear contato) só roda uma vez.
        if (!await claimDelivery(db, claimKey, "outcome-label")) continue;

        try {
          const r = await fetch(
            `http://localhost:${port}/funil-control?token=${
              encodeURIComponent(secret)
            }`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action,
                chatwoot_conversation_id: cwConvId,
              }),
            },
          );
          const result = await r.json().catch(() => ({}));
          if (!r.ok || result.ok !== true) {
            console.warn(
              "outcome-label-poll: falha, libera pra retry",
              label,
              cwConvId,
              JSON.stringify(result).slice(0, 150),
            );
            await releaseDelivery(db, claimKey);
            continue;
          }
          console.log(
            "outcome-label-poll:",
            label,
            "conv",
            cwConvId,
            "->",
            action,
            "ok",
          );
        } catch (e) {
          console.error("outcome-label-poll exec erro:", e);
          await releaseDelivery(db, claimKey);
        }
      }
    } catch (e) {
      console.error("outcome-label-poll erro:", e);
    }
  };
  agendarLoop("outcome-label-poll", tick, {
    intervaloMs: OUTCOME_LABEL_POLL_INTERVAL_MS,
    primeiraEmMs: 12_000,
  });
  console.log(
    "outcome-label-poll loop ON (20s, filter API) -- etiquetas pago/nao-compra",
  );
}

Deno.serve({ port }, async (req) => {
  const reqUrl = new URL(req.url);
  const { pathname } = reqUrl;

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (pathname === "/health") return new Response("ok");
  if (pathname === "/version") {
    return new Response(
      JSON.stringify({
        ...version,
        started_at: STARTED_AT,
        uptime_s: Math.round((Date.now() - Date.parse(STARTED_AT)) / 1000),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }
  if (pathname === "/hybrid-diag") {
    // Era a única rota do arquivo sem autenticação — respondia 200 para qualquer um na
    // internet devolvendo, entre outras coisas, o `chatwoot_inbox_identifier` de cada canal.
    // Esse identifier NÃO é um dado inócuo: é com ele que o próprio bridge cria contato e
    // mensagem em `/public/api/v1/inboxes/{identifier}/...` (shared/chatwoot.ts), rota que
    // não pede header nenhum. Ou seja, era credencial de escrita nas inboxes do Chatwoot,
    // exposta publicamente.
    //
    // Aceita Bearer OU ?token= de propósito: é rota de diagnóstico manual, e exigir JWT do
    // painel tiraria a possibilidade de consultar pelo terminal. Mesmo padrão do
    // /label-window.
    if (!diagAutorizado(req, reqUrl)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    try {
      const db = admin();
      const { data: ch } = await db.from("channels")
        .select(
          "id,name,phone_number,phone_number_id,chatwoot_inbox_id,type,status",
        )
        .eq("type", "whatsapp").not("phone_number_id", "is", null);
      const inst = uazapiConfigured()
        ? await (await import("./shared/uazapi.ts")).listInstances()
        : [];
      const norm = (n: string | null) => (n ?? "").replace(/\D/g, "");
      const diag = (ch ?? []).map((c: Record<string, unknown>) => {
        const cp = norm(c.phone_number as string | null);
        const match = inst.find((i: Record<string, unknown>) =>
          i.status === "connected" && norm(i.number as string | null) === cp
        );
        return {
          channel: c.name,
          phone: c.phone_number,
          phone_norm: cp || "(vazio)",
          chatwoot_inbox_id: c.chatwoot_inbox_id ?? null,
          // `chatwoot_inbox_identifier` sai daqui de vez: o diagnóstico (canal -> telefone ->
          // instância uazapi casada) não precisa dele, e ele é credencial de escrita.
          uaz_match: match ? (match as Record<string, unknown>).name : null,
        };
      });
      const instList = inst.map((i: Record<string, unknown>) => ({
        name: i.name,
        number: i.number,
        norm: norm(i.number as string | null),
        status: i.status,
      }));
      return new Response(
        JSON.stringify({ channels: diag, uazapi_instances: instList }, null, 2),
        {
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
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
    try {
      const r = await syncChannels(admin());
      if (r.updated) console.log("channel-sync:", JSON.stringify(r));
    } catch (e) {
      console.error("channel-sync erro:", e);
    }
  };
  agendarLoop("channel-sync", run, {
    intervaloMs: 5 * 60 * 1000,
    primeiraEmMs: 45_000,
  });
}

function startFunnelQueueLoop() {
  // Mesma trava do campaign-queue: tick de 30s mandando até 10 peças com mídia passa do
  // intervalo com folga, e rodadas sobrepostas dobram o ritmo do funil.
  let rodando = false;
  const run = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const result = await pumpFunnelQueue(10);
      if (result.found) {
        console.log("funnel-queue-pump:", JSON.stringify(result));
      }
    } catch (e) {
      console.error("funnel-queue-pump erro:", e);
    } finally {
      rodando = false;
    }
  };
  setTimeout(run, 20_000);
  setInterval(run, 30_000);
  console.log("funnel-queue-pump loop ON (30s)");
}

// Cadeia automática de recuperação (1·2·4·7 dias). DESLIGADA por padrão: ligar significa
// mandar mensagem sozinha pra centenas de leads parados, e essa decisão é do dono da conta,
// não default de deploy. Liga com RECOVERY_CHAIN_ENABLED=true.
async function runRecoveryChain() {
  if (optionalEnv("RECOVERY_CHAIN_ENABLED") !== "true") return null;
  const teto = Number(optionalEnv("RECOVERY_CHAIN_MAX_PER_ROUND") ?? "5");
  return await pumpRecoveryChain(
    admin(),
    async (conv, cwConvId, variation) => {
      const acct = await accountForChannel(String(conv.channel_id ?? ""));
      const response = await dispatchRecovery(
        admin(),
        conv,
        cwConvId,
        variation,
        acct,
      );
      return response.ok;
    },
    Date.now(),
    Number.isFinite(teto) && teto > 0 ? teto : 5,
  );
}

// Fila de campanha — entrega UM contato por vez, no ritmo configurado.
//
// O loop roda de minuto em minuto, mas quem decide se manda é `podeEnviarAgora`: janela de
// horário, teto do dia (que sobe pela rampa) e intervalo desde o último envio. Um contato por
// tick no máximo — é o que espalha 200 mensagens por 14 horas em vez de despejá-las juntas.
// Kill-switch: CAMPAIGN_QUEUE_ENABLED=false.
const CAMPAIGN_QUEUE_INTERVAL_MS = 60_000;

function startCampaignQueueLoop() {
  if (optionalEnv("CAMPAIGN_QUEUE_ENABLED") === "false") return;
  // Trava de reentrância. `setInterval` dispara de 60 em 60s SEM esperar a rodada anterior
  // terminar, e uma rodada que manda vídeo de 14 MB com as pausas do fluxo passa disso com
  // folga. Duas rodadas simultâneas liam `enviadosHoje` e `ultimoEnvioAt` antes de qualquer
  // uma gravar, as duas decidiam "pode enviar", e o ritmo virava rajada.
  //
  // Medido em 20/08: três envios em 25s (19:57:47, :55, 20:58:12) e o teto do dia estourado
  // em 82/80. `reservarItem` não cobre isso — ele impede dois ticks pegarem o MESMO contato,
  // não dois ticks pegarem contatos diferentes ao mesmo tempo.
  let rodando = false;
  const run = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const db = admin();
      const campanhas = await campanhasComFila(db);
      if (!campanhas.length) return;

      const state = await readCampaigns();
      for (const campaignId of campanhas) {
        const camp = state.campaigns.find((c) => c.id === campaignId);
        if (!camp?.flow) continue;

        const cfg = { ...PACE_PADRAO, ...(camp.pace ?? {}) };
        const decisao = podeEnviarAgora({
          cfg,
          inicioCampanha: Date.parse(camp.createdAt),
          enviadosHoje: await enviadosHoje(db, campaignId),
          ultimoEnvioAt: await ultimoEnvioAt(db, campaignId),
          now: Date.now(),
        });
        if (!decisao.enviar) continue;

        const item = await proximoDaFila(db, campaignId);
        if (!item) continue;
        // Reserva antes de enviar: dois ticks não pegam o mesmo contato.
        if (!await reservarItem(db, item.id)) continue;

        try {
          const { data: canal } = await db.from("channels")
            .select(
              "id,type,name,phone_number,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier",
            )
            .eq("id", item.channel_id).maybeSingle();
          if (!canal) {
            await marcarPulado(db, item.id, "canal não encontrado");
            continue;
          }
          // Bot travado à mão vale mais que qualquer campanha. item.contact_key é o
          // TELEFONE (external_contact_id), não um id de conversa. Passá-lo a
          // mutedConversationIds, que faz `.in("id", ...)` contra o uuid da conversa, fazia
          // o Postgres rejeitar o número como uuid (22P02) e lançar erro para TODO contato —
          // derrubava a campanha inteira antes de enviar. Resolve pelo par (canal, contato).
          const muted = await isBotMutedForContact(
            db,
            String(canal.id),
            item.contact_key,
          );
          if (muted) {
            await marcarPulado(db, item.id, "bot-off");
            continue;
          }

          const ch = await flowChannelFor(db, canal as Record<string, unknown>);
          const r = await runFlow(
            camp.flow,
            ch,
            item.contact_key,
            null,
            Date.now(),
            gravadorDeFluxo(
              db,
              canal as Record<string, unknown>,
              item.contact_key,
              await accountForChannel(String(canal.id)),
            ),
          );
          await saveFlowPosition(db, campaignId, item.contact_key, r.position, {
            channelId: String(canal.id),
          });
          if (r.enviados > 0) {
            await marcarEnviado(db, item.id);
            console.log(
              "campaign-queue:",
              campaignId,
              item.contact_key.slice(-4),
              `enviados=${r.enviados} parou=${r.position.stepId ?? "fim"}`,
            );
          } else {
            await marcarFalha(
              db,
              item,
              `nenhuma peça saiu (falhas=${r.falhas})`,
            );
          }
        } catch (e) {
          // Erro do PostgREST/Supabase é objeto simples, não Error: String(e) virava
          // "[object Object]" e escondia a causa. Guarda a mensagem real em last_error.
          const msg = e instanceof Error
            ? e.message
            : (e && typeof e === "object" ? JSON.stringify(e) : String(e));
          await marcarFalha(db, item, msg);
          console.error("campaign-queue erro:", item.contact_key.slice(-4), e);
        }
      }
    } catch (e) {
      console.error("campaign-queue loop erro:", e);
    } finally {
      rodando = false;
    }
  };
  setTimeout(run, 120_000);
  setInterval(run, CAMPAIGN_QUEUE_INTERVAL_MS);
  console.log("campaign-queue loop ON (1min, ritmo por campanha)");
}

const DECLINE_GUARD_INTERVAL_MS = 5 * 60_000;

// Marca outcome=lost pra quem clica um botão de recusa explícito num fluxo de campanha —
// sem isso, a próxima campanha (e a que vier depois dela) precisaria repetir a varredura
// manual de exclusão feita pra sul-grupo-b-6836. Ver shared/decline-guard.ts.
function startDeclineGuardLoop() {
  const run = async () => {
    try {
      const result = await runDeclineGuard(admin());
      if (result.marked) {
        console.log("decline-guard:", JSON.stringify(result));
      }
    } catch (e) {
      console.error("decline-guard loop erro:", e);
    }
  };
  agendarLoop("decline-guard", run, {
    intervaloMs: DECLINE_GUARD_INTERVAL_MS,
    primeiraEmMs: 90_000,
  });
  console.log("decline-guard loop ON (5min)");
}

function startFunnelRecoveryLoop() {
  const run = async () => {
    try {
      const result = await recoverEligibleFunnels(admin(), 48);
      const maintenance = await maintainFunnels(admin());
      const chain = await runRecoveryChain();
      if (
        result.eligible || result.enrolled || maintenance.completed ||
        maintenance.resumed || maintenance.followups || chain?.sent ||
        chain?.failed || chain?.encerradas
      ) {
        console.log(
          "funnel-recovery:",
          JSON.stringify({ eligible: result, maintenance, chain }),
        );
      }
    } catch (e) {
      console.error("funnel-recovery erro:", e);
    }
  };
  agendarLoop("funnel-recovery", run, {
    intervaloMs: 5 * 60_000,
    primeiraEmMs: 60_000,
  });
  console.log(
    "funnel-recovery loop ON (5min, follow-up 10h úteis + auto-resume)",
  );
}

// Fluxos cuja espera venceu seguem sozinhos pelo caminho de timeout. 2 min é folgado: a
// régua real é o `timeoutMin` de cada pergunta (tipicamente horas), e este loop só decide
// quando olhar. Kill-switch: FLOW_TIMEOUT_ENABLED=false.
const FLOW_TIMEOUT_INTERVAL_MS = 2 * 60_000;

function startFlowTimeoutLoop() {
  if (optionalEnv("FLOW_TIMEOUT_ENABLED") === "false") return;
  // Trava de reentrância: este loop também envia (segue o fluxo de quem não respondeu), e
  // sobreposição faria o lead receber a continuação duas vezes.
  let rodando = false;
  const run = async () => {
    if (rodando) return;
    rodando = true;
    try {
      const r = await pumpFlowTimeouts(admin());
      if (r.seguiram > 0) {
        console.log("flow-timeout:", JSON.stringify(r));
      }
    } catch (e) {
      console.error("flow-timeout loop erro:", e);
    } finally {
      rodando = false;
    }
  };
  setTimeout(run, 90_000);
  setInterval(run, FLOW_TIMEOUT_INTERVAL_MS);
  console.log("flow-timeout loop ON (2min)");
}

// Bearer ou ?token=, comparado em tempo constante. Mesmo segredo já usado pelos loops
// internos (SYNC_SECRET, com CHATWOOT_WEBHOOK_SECRET como retaguarda).
function diagAutorizado(req: Request, url: URL): boolean {
  const bearer = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const informado = bearer || url.searchParams.get("token") || "";
  const esperado = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  return timingSafeEqual(informado, esperado);
}

function startOperationalMonitorLoop() {
  const run = async () => {
    try {
      const result = await runOperationalAudit(admin());
      console.log(
        "operational-monitor:",
        JSON.stringify({
          ok: result.ok,
          issues: result.issues,
          checked_at: result.checked_at,
        }),
      );
    } catch (error) {
      console.error("operational-monitor erro:", error);
    }
  };
  agendarLoop("operational-monitor", run, {
    intervaloMs: 15 * 60_000,
    primeiraEmMs: 90_000,
  });
  console.log("operational-monitor loop ON (15min)");
}

if (optionalEnv("AUTO_LOOPS_ENABLED") === "false") {
  console.log("background loops OFF (AUTO_LOOPS_ENABLED=false)");
} else {
  startSyncLoop();
  startCommentsLoop();
  startAvatarLoop();
  startChatwootOutLoop();
  startLabelWindowLoop();
  startSyncLabelsLoop();
  startSyncWaLabelsLoop();
  startRollupLoop();
  startRetentionLoop();
  startEnrichLoop();
  startChannelSyncLoop();
  startDataCleanupLoop();
  startMacroCommandLoop();
  startOutcomeLabelLoop();
  startDeclineGuardLoop();
  startBotMuteLoop();
  startFunnelQueueLoop();
  startFunnelRecoveryLoop();
  startFlowTimeoutLoop();
  startCampaignQueueLoop();
  startOperationalMonitorLoop();
}
console.log(`bridge ouvindo na porta ${port}`);
