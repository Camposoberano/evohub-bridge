import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env, optionalEnv } from "../shared/env.ts";
import { getMeta } from "../shared/hub.ts";
import {
  avaliarInstanciasUazapi,
  avaliarSilencio,
  entregarAlertas,
  type OperationalIssue,
} from "../shared/operational-alert.ts";
import { listInstances, uazapiConfigured } from "../shared/uazapi.ts";
import {
  admin,
  claimDeliveryWithTtl,
  type DbClient,
} from "../shared/supabase.ts";
import { MAIN_FUNNELS } from "../shared/funnel-identity.ts";

type Json = Record<string, unknown>;

// Motivos que marcam desligamento deliberado do canal, escritos à mão em channels.last_error.
export const DESLIGAMENTO_INTENCIONAL = /preservado e suspenso|duplicad/i;

async function authenticated(req: Request): Promise<boolean> {
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  return Boolean((await client.auth.getUser()).data?.user);
}

async function exactCount(query: any): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function ensureMonitoringWindow(db: DbClient, now: Date): Promise<Json> {
  const { data: latest } = await db.from("events").select("payload,received_at")
    .eq("source", "operational-monitor")
    .eq("event_type", "operational_monitor_started")
    .order("received_at", { ascending: false }).limit(1).maybeSingle();
  const payload = (latest?.payload ?? {}) as Json;
  const endsAt = Date.parse(String(payload.ends_at ?? ""));
  if (Number.isFinite(endsAt) && endsAt > now.getTime()) return payload;

  const window = {
    started_at: now.toISOString(),
    ends_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    days: 7,
  };
  await db.from("events").insert({
    source: "operational-monitor",
    event_type: "operational_monitor_started",
    payload: window,
  });
  return window;
}

export async function runOperationalAudit(db: DbClient): Promise<Json> {
  const now = new Date();
  const monitoringWindow = await ensureMonitoringWindow(db, now);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since15m = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const overdue = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const [
    channelsResult,
    failedMessages15m,
    failedMessages24h,
    overdueQueue,
    recentContacts,
    adConversations,
  ] = await Promise.all([
    db.from("channels").select(
      "id,name,type,status,phone_number,phone_number_id,external_id,display_name,page_id,ig_id,owner_name,owner_identifier,last_error",
    ).order("name"),
    exactCount(
      db.from("messages").select("id", { count: "exact", head: true })
        .eq("status", "failed").gte("sent_at", since15m),
    ),
    exactCount(
      db.from("messages").select("id", { count: "exact", head: true })
        .eq("status", "failed").gte("sent_at", since24h),
    ),
    exactCount(
      db.from("scheduled_messages").select("id", { count: "exact", head: true })
        .eq("status", "pending").lt("send_at", overdue),
    ),
    db.from("contacts").select("id,name,phone,attributes,channel_id")
      .gte("last_seen_at", since24h).limit(3000),
    db.from("conversations").select(
      "id,channel_id,opened_at,ad_id,creative_id,attribution",
    )
      .eq("origem", "anuncio").gte("opened_at", since24h).limit(3000),
  ]);
  if (channelsResult.error) throw channelsResult.error;
  if (recentContacts.error) throw recentContacts.error;
  if (adConversations.error) throw adConversations.error;

  const channels = (channelsResult.data ?? []) as Json[];
  const contacts = (recentContacts.data ?? []) as Json[];
  const ads = (adConversations.data ?? []) as Json[];
  const channelTypeById = new Map(
    channels.map((
      channel,
    ) => [String(channel.id), String(channel.type ?? "unknown")]),
  );
  const { data: firstStepRows, error: firstStepError } = await db
    .from("scheduled_messages")
    .select("id,conversation_id,status,send_at,payload")
    .in("funnel", MAIN_FUNNELS)
    .eq("step", 0)
    .gte("send_at", since24h)
    .order("send_at", { ascending: false })
    .limit(5000);
  if (firstStepError) throw firstStepError;
  const { data: providerMessages, error: providerMessagesError } = await db
    .from("messages")
    .select("scheduled_message_id,status,meta_message_id")
    .eq("direction", "out")
    .not("scheduled_message_id", "is", null)
    .gte("sent_at", since24h)
    .limit(5000);
  if (providerMessagesError) throw providerMessagesError;
  const providerConfirmedMessageIds = new Set(
    ((providerMessages ?? []) as Json[])
      .filter((message) => message.status === "sent" && message.meta_message_id)
      .map((message) => String(message.scheduled_message_id)),
  );
  const firstStepByConversation = new Map<string, Json>();
  for (const row of (firstStepRows ?? []) as Json[]) {
    const key = String(row.conversation_id ?? "");
    if (!key) continue;
    const current = firstStepByConversation.get(key);
    if (!current || row.status === "sent") {
      firstStepByConversation.set(key, row);
    }
  }
  const adFirstStepByChannel: Record<string, Record<string, number>> = {};
  const adFirstStepCutoff = now.getTime() - 15 * 60_000;
  for (const ad of ads) {
    const channelType = channelTypeById.get(String(ad.channel_id ?? "")) ??
      "unknown";
    const counts = adFirstStepByChannel[channelType] ??= {
      sent: 0,
      unverified_sent: 0,
      not_enrolled: 0,
      failed: 0,
      paused: 0,
      overdue_pending: 0,
      waiting: 0,
      cancelled: 0,
    };
    const openedAt = Date.parse(String(ad.opened_at ?? ""));
    const firstStep = firstStepByConversation.get(String(ad.id));
    if (firstStep?.status === "sent") {
      const payload = (firstStep.payload ?? {}) as Json;
      const delivery = (payload.__funnel_delivery ?? {}) as Json;
      if (
        delivery.last_outcome === "sent" ||
        providerConfirmedMessageIds.has(String(firstStep.id))
      ) counts.sent++;
      else counts.unverified_sent++;
    } else if (firstStep?.status === "cancelled") {
      counts.cancelled++;
    } else if (firstStep?.status === "failed") {
      counts.failed++;
    } else if (firstStep?.status === "paused") {
      counts.paused++;
    } else if (!firstStep) {
      if (Number.isFinite(openedAt) && openedAt <= adFirstStepCutoff) {
        counts.not_enrolled++;
      } else {
        counts.waiting++;
      }
    } else {
      const dueAt = Date.parse(String(firstStep.send_at ?? ""));
      if (
        Number.isFinite(dueAt) &&
        dueAt < now.getTime() - 10 * 60_000
      ) counts.overdue_pending++;
      else counts.waiting++;
    }
  }
  const missingAdFirstSteps = Object.values(adFirstStepByChannel)
    .reduce(
      (sum, counts) =>
        sum + counts.not_enrolled + counts.failed + counts.paused +
        counts.overdue_pending,
      0,
    );
  const unverifiedAdFirstSteps = Object.values(adFirstStepByChannel)
    .reduce((sum, counts) => sum + counts.unverified_sent, 0);
  const activeChannels = channels.filter((item) =>
    item.status === "active" || item.status === "connected"
  );
  const missingOwner = activeChannels.filter((item) => !item.owner_name).length;
  const missingName =
    contacts.filter((item) => !String(item.name ?? "").trim()).length;
  const missingAvatar = contacts.filter((item) => {
    const attrs = (item.attributes ?? {}) as Json;
    return !attrs.avatar_url && attrs.avatar_set !== true;
  }).length;
  const missingIdentifier = contacts.filter((item) => {
    const attrs = (item.attributes ?? {}) as Json;
    return !attrs.platform_id;
  }).length;
  const attributionGaps = ads.filter((item) => {
    const attribution = (item.attribution ?? {}) as Json;
    return !item.ad_id && !item.creative_id && !attribution.ad_id &&
      !attribution.creative_id;
  }).length;
  const disconnectedChannels = channels.filter((item) =>
    item.status !== "active" && item.status !== "connected"
  );
  // Canal desligado COM motivo declarado é decisão, não incidente: vira warning (que não é
  // entregue) em vez de crítico. Sem isso o "Atendimento FB", desativado de propósito por ser
  // duplicata do Mega Sorgo, mandaria alerta de hora em hora para sempre.
  const knownSuspended =
    disconnectedChannels.filter((item) =>
      DESLIGAMENTO_INTENCIONAL.test(String(item.last_error ?? ""))
    ).length;
  const disconnected = disconnectedChannels.length - knownSuspended;

  // --- checagens acrescentadas depois do incidente de 29/08 -----------------------------
  // 1) token social morre em silêncio: o do Atendimento IG expirou 26/08 e o canal ficou
  //    ~28h mudo; o do sorgo brasileiro ficou 3 dias. `status` continua "active" nos dois.
  const canaisSociais = activeChannels.filter((c) =>
    c.type === "facebook" || c.type === "instagram"
  );
  const tokensInvalidos: string[] = [];
  for (const canal of canaisSociais) {
    const { data: secret } = await db.from("channel_secrets")
      .select("channel_token").eq("channel_id", canal.id).maybeSingle();
    const token = secret?.channel_token as string | undefined;
    if (!token) {
      tokensInvalidos.push(`${canal.name}: sem token`);
      continue;
    }
    try {
      const r = await getMeta(token, "me?fields=id");
      if (!r.ok) tokensInvalidos.push(`${canal.name}: HTTP ${r.status}`);
    } catch {
      // erro de rede não é token inválido — não vira alarme
    }
  }

  // 2) canal que costuma receber e parou: só alarma quem tem volume (>=20 entradas em 7d),
  //    senão canal naturalmente quieto viraria alerta todo dia.
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString();
  const canaisMudos: string[] = [];
  for (const canal of activeChannels) {
    // SEMPRE em ordem decrescente. A primeira versão pedia 3000 linhas em ordem
    // ASCENDENTE: no 5895, que tem 7.615 linhas por semana, isso entregava as 3.000 mais
    // ANTIGAS, a "última entrada" caía em 24/08 e o alerta acusou 150h de silêncio num
    // canal que tinha recebido 54 minutos antes. Truncamento silencioso vindo do próprio
    // monitor.
    const { data: recentes } = await db.from("messages")
      .select("sent_at").eq("channel_id", canal.id).eq("direction", "in")
      .gte("sent_at", since7d)
      .order("sent_at", { ascending: false }).limit(500);
    const entradas = ((recentes ?? []) as Json[])
      .map((m) => Date.parse(String(m.sent_at))).filter(Number.isFinite);
    if (entradas.length < 20) continue;

    // basta saber se houve QUALQUER envio nosso depois da última entrada
    const ultimaEntrada = new Date(Math.max(...entradas)).toISOString();
    const { data: saidaDepois } = await db.from("messages")
      .select("sent_at").eq("channel_id", canal.id).eq("direction", "out")
      .gt("sent_at", ultimaEntrada)
      .order("sent_at", { ascending: false }).limit(1);
    const saidas = ((saidaDepois ?? []) as Json[])
      .map((m) => Date.parse(String(m.sent_at))).filter(Number.isFinite);

    const veredito = avaliarSilencio(entradas, saidas, now.getTime());
    if (veredito.anormal) {
      canaisMudos.push(
        `${canal.name} (${veredito.silencioAtualH}h calado; o normal dele é até ` +
          `${veredito.maiorSilencioHabitualH}h, e seguimos enviando)`,
      );
    }
  }

  // 3) mensagem perdida na ingestão: os eventos existem desde o conserto do claim órfão,
  //    mas ninguém os consumia.
  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const perdidasIngest = await exactCount(
    db.from("events").select("id", { count: "exact", head: true })
      .in("event_type", ["inbound_ingest_failed", "chatwoot_post_failed"])
      .gte("received_at", since1h),
  );
  const { data: funnelDeliveryEvents, error: deliveryEventsError } = await db
    .from("events").select("received_at,payload")
    .eq("event_type", "funnel_delivery_attempt")
    .gte("received_at", since1h)
    .order("received_at", { ascending: false })
    .limit(3000);
  if (deliveryEventsError) throw deliveryEventsError;
  const funnelDeliveryByChannel: Record<string, Record<string, number>> = {};
  const latestAttemptOutcome = new Map<string, {
    outcome: string;
    channel_type: string;
    received_at: string;
  }>();
  for (const event of (funnelDeliveryEvents ?? []) as Json[]) {
    const payload = (event.payload ?? {}) as Json;
    const outcome = String(payload.outcome ?? "unknown");
    const channelType = String(payload.channel_type ?? "unknown");
    const attemptId = String(payload.attempt_id ?? "");
    if (attemptId && !latestAttemptOutcome.has(attemptId)) {
      latestAttemptOutcome.set(attemptId, {
        outcome,
        channel_type: channelType,
        received_at: String(event.received_at ?? ""),
      });
    }
    if (outcome === "started") continue;
    const outcomes = funnelDeliveryByChannel[channelType] ??= {};
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  let staleStartedAttempts = 0;
  for (const latest of latestAttemptOutcome.values()) {
    const startedAt = Date.parse(latest.received_at);
    if (
      latest.outcome === "started" &&
      Number.isFinite(startedAt) &&
      startedAt < now.getTime() - 10 * 60_000
    ) {
      const outcomes = funnelDeliveryByChannel[latest.channel_type] ??= {};
      outcomes.uncertain = (outcomes.uncertain ?? 0) + 1;
      staleStartedAttempts++;
    }
  }
  const deliveryFailures = Object.values(funnelDeliveryByChannel)
    .reduce(
      (sum, outcomes) =>
        sum + (outcomes.rejected ?? 0) + (outcomes.uncertain ?? 0) +
        (outcomes.media_unavailable ?? 0) + (outcomes.partial ?? 0),
      0,
    );
  const scheduledDeliveryRetries = Object.values(funnelDeliveryByChannel)
    .reduce((sum, outcomes) => sum + (outcomes.retry_scheduled ?? 0), 0);

  // 3b) instância uazapi entregando sem canal cadastrado: o número foi conectado, o cliente
  //     está escrevendo, e o webhook descarta tudo porque não existe linha em `channels`.
  //     O nome da instância é o que a pessoa precisa pra cadastrar -- por isso vai no detalhe.
  const { data: eventosSemCanal } = await db.from("events")
    .select("payload").eq("event_type", "inbound_sem_canal")
    .gte("received_at", since1h);
  const instanciasSemCanal = [
    ...new Set(
      ((eventosSemCanal ?? []) as Json[])
        .map((e) => String(((e.payload ?? {}) as Json).instance ?? "").trim())
        .filter(Boolean),
    ),
  ];

  // 3c) instância uazapi caída com o canal `active` no banco (6836, 10/09). Uma consulta
  //     por rodada; uazapi inacessível não é instância caída — não vira alarme.
  let instanciasCaidas: string[] = [];
  if (uazapiConfigured()) {
    try {
      instanciasCaidas = avaliarInstanciasUazapi(
        activeChannels,
        await listInstances(),
      );
    } catch {
      // erro de rede na uazapi não é instância desconectada
    }
  }

  // 3d) peça do funil que aponta para arquivo ausente; o envio fica bloqueado até correção.
  const { data: eventosMidia } = await db.from("events")
    .select("payload").eq("event_type", "midia_indisponivel")
    .gte("received_at", since1h);
  const midiasSumidas = [
    ...new Set([
      ...((eventosMidia ?? []) as Json[]).map((e) => {
        const payload = (e.payload ?? {}) as Json;
        if (payload.media_key) return String(payload.media_key);
        const url = String(payload.url ?? "");
        return url
          ? decodeURIComponent(url.split("?")[0].split("/").pop() ?? url)
          : "";
      }),
      ...((funnelDeliveryEvents ?? []) as Json[])
        .filter((e) =>
          ((e.payload ?? {}) as Json).outcome === "media_unavailable"
        )
        .map((e) => String(((e.payload ?? {}) as Json).media_key ?? "")),
    ].filter(Boolean)),
  ];
  // 3d) mensagem de cliente que o catch-up achou fora do webhook: entrou sem automação e
  //     alguém precisa responder. O evento vale por uma hora, o alerta sai uma vez.
  const { data: eventosRecuperadas } = await db.from("events")
    .select("payload").eq("event_type", "inbound_recovered")
    .gte("received_at", since1h);
  const recuperadasPorCanal = new Map<string, number>();
  for (const e of (eventosRecuperadas ?? []) as Json[]) {
    const p = (e.payload ?? {}) as Json;
    const canal = String(p.canal ?? p.instancia ?? "?");
    recuperadasPorCanal.set(
      canal,
      (recuperadasPorCanal.get(canal) ?? 0) + Number(p.recuperadas ?? 0),
    );
  }
  const totalRecuperadas = [...recuperadasPorCanal.values()].reduce(
    (s, n) => s + n,
    0,
  );
  // 3e) a varredura da uazapi não conseguiu fazer o trabalho dela (401 no /instance/all,
  //     consulta falhando, lista truncada). É rede de segurança: se ela cai calada, só se
  //     descobre no próximo incidente, contando mensagem de cliente perdida.
  const { data: eventosCatchup } = await db.from("events")
    .select("payload").eq("event_type", "catchup_degradado")
    .gte("received_at", since1h);
  const motivosCatchup = new Map<string, number>();
  for (const e of (eventosCatchup ?? []) as Json[]) {
    const p = (e.payload ?? {}) as Json;
    const motivo = String(p.motivo ?? "?");
    motivosCatchup.set(motivo, (motivosCatchup.get(motivo) ?? 0) + 1);
  }
  // 3f) cliente clicou "Falar com Cícero". O bot responde "já te conectei", o funil para —
  //     e a partir daqui é uma pessoa que tem que aparecer. Em 13/09 foram 8 pedidos em 5
  //     dias, nenhum com atendente: o alerta existe para esse silêncio não se repetir.
  const { data: eventosHumano } = await db.from("events")
    .select("payload").eq("event_type", "pediu_humano")
    .gte("received_at", since1h);
  const pedidosHumano = ((eventosHumano ?? []) as Json[]).map((e) => {
    const p = (e.payload ?? {}) as Json;
    return `#${p.chatwoot_conversation_id ?? "?"} ${p.contato ?? ""}`.trim();
  });

  const issues = [
    { key: "channel_disconnected", severity: "critical", count: disconnected },
    {
      key: "midia_indisponivel",
      severity: "critical",
      count: midiasSumidas.length,
      detail: midiasSumidas.slice(0, 6).join("; ") || undefined,
    },
    {
      key: "inbound_recovered",
      severity: "critical",
      count: totalRecuperadas,
      detail:
        [...recuperadasPorCanal].map(([c, n]) => `${c}: ${n}`).join("; ") ||
        undefined,
    },
    {
      key: "pediu_humano",
      severity: "critical",
      count: pedidosHumano.length,
      detail: pedidosHumano.slice(0, 8).join("; ") || undefined,
    },
    {
      key: "catchup_degradado",
      severity: "critical",
      count: motivosCatchup.size ? 1 : 0,
      detail: [...motivosCatchup].map(([m, n]) => `${m} (${n}x)`).join("; ") ||
        undefined,
    },
    {
      key: "uazapi_instance_disconnected",
      severity: "critical",
      count: instanciasCaidas.length,
      detail: instanciasCaidas.join("; ") || undefined,
    },
    {
      key: "canal_nao_cadastrado",
      severity: "critical",
      count: instanciasSemCanal.length,
      detail: instanciasSemCanal.join("; ") || undefined,
    },
    {
      key: "social_token_invalid",
      severity: "critical",
      count: tokensInvalidos.length,
      detail: tokensInvalidos.join("; ") || undefined,
    },
    {
      key: "channel_silent",
      severity: "critical",
      count: canaisMudos.length,
      detail: canaisMudos.join("; ") || undefined,
    },
    {
      key: "inbound_lost",
      severity: "critical",
      count: perdidasIngest,
      detail: perdidasIngest ? "última hora" : undefined,
    },
    {
      key: "channel_known_suspended",
      severity: "warning",
      count: knownSuspended,
    },
    {
      key: "failed_messages_15m",
      severity: "critical",
      count: failedMessages15m,
    },
    {
      key: "failed_messages_history_24h",
      severity: "warning",
      count: failedMessages24h,
    },
    { key: "overdue_funnel_queue", severity: "critical", count: overdueQueue },
    {
      key: "funnel_delivery_failure_1h",
      severity: "critical",
      count: deliveryFailures,
      detail: Object.entries(funnelDeliveryByChannel)
        .map(([channel, outcomes]) => {
          const failed = (outcomes.rejected ?? 0) + (outcomes.uncertain ?? 0) +
            (outcomes.media_unavailable ?? 0) + (outcomes.partial ?? 0);
          return failed ? channel + ": " + failed : "";
        }).filter(Boolean).join("; ") || undefined,
    },
    {
      key: "funnel_delivery_retries_1h",
      severity: "warning",
      count: scheduledDeliveryRetries,
    },
    {
      key: "ad_first_step_unverified_24h",
      severity: "warning",
      count: unverifiedAdFirstSteps,
    },
    {
      key: "ad_first_step_missing_24h",
      severity: "critical",
      count: missingAdFirstSteps,
      detail: Object.entries(adFirstStepByChannel)
        .map(([channel, counts]) => {
          const missing = counts.not_enrolled + counts.failed + counts.paused +
            counts.overdue_pending;
          return missing ? channel + ": " + missing : "";
        }).filter(Boolean).join("; ") || undefined,
    },
    {
      key: "lead_missing_identifier_24h",
      severity: "critical",
      count: missingIdentifier,
    },
    {
      key: "ad_attribution_gap_24h",
      severity: "warning",
      count: attributionGaps,
    },
    { key: "lead_missing_name_24h", severity: "warning", count: missingName },
    {
      key: "lead_missing_avatar_24h",
      severity: "warning",
      count: missingAvatar,
    },
    { key: "channel_without_owner", severity: "warning", count: missingOwner },
  ].filter((issue) => issue.count > 0);

  for (const issue of issues) {
    const claimed = await claimDeliveryWithTtl(
      db,
      `operational-alert-${issue.key}`,
      "operational-monitor",
      60 * 60 * 1000,
      now,
    );
    if (claimed) {
      await db.from("events").insert({
        source: "operational-monitor",
        event_type: "operational_alert",
        payload: { ...issue, checked_at: now.toISOString() },
      });
    }
  }

  const entrega = await entregarAlertas(
    db,
    issues as OperationalIssue[],
    now,
  ).catch((e) => {
    console.error("operational-alert erro:", e);
    return { enviado: false, motivo: "excecao" };
  });

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
    alerta: entrega,
    checked_at: now.toISOString(),
    monitoring_window: monitoringWindow,
    ai: {
      enabled: Boolean(
        optionalEnv("OPENAI_API_KEY") || optionalEnv("GEMINI_API_KEY"),
      ),
      text_model: optionalEnv("OPENAI_EXEC_MODEL") ?? null,
      audio_provider: optionalEnv("AUDIO_TRANSCRIBE_PROVIDER") ?? "openai",
      audio_model: optionalEnv("GEMINI_TRANSCRIBE_MODEL") ?? null,
    },
    totals: {
      channels: channels.length,
      active_channels: activeChannels.length,
      recent_contacts_24h: contacts.length,
      ad_conversations_24h: ads.length,
      ad_first_steps_24h: adFirstStepByChannel,
      ad_first_steps_unverified_24h: unverifiedAdFirstSteps,
      funnel_delivery_1h: funnelDeliveryByChannel,
      funnel_stale_attempts_1h: staleStartedAttempts,
      failed_messages_24h: failedMessages24h,
    },
    issues,
    channels,
  };
}

export async function handle(req: Request): Promise<Response> {
  if (!(await authenticated(req))) return json({ error: "unauthorized" }, 401);
  const db = admin();
  if (req.method === "PATCH" || req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Json;
    const channelId = String(body.channel_id ?? "").trim();
    if (!channelId) return json({ error: "channel_id obrigatorio" }, 400);
    const { data, error } = await db.from("channels").update({
      owner_name: String(body.owner_name ?? "").trim() || null,
      owner_identifier: String(body.owner_identifier ?? "").trim() || null,
    }).eq("id", channelId).select("id,name,owner_name,owner_identifier")
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "canal nao encontrado" }, 404);
    await db.from("conversations").update({
      source_owner_name: data.owner_name,
    }).eq("channel_id", channelId);
    const { data: contacts } = await db.from("contacts").select("id,attributes")
      .eq("channel_id", channelId).limit(5000);
    await Promise.all(
      (contacts ?? []).map((contact: Json) =>
        db.from("contacts").update({
          attributes: {
            ...((contact.attributes ?? {}) as Json),
            source_owner_name: data.owner_name,
          },
        }).eq("id", contact.id)
      ),
    );
    await db.from("events").insert({
      source: "dashboard",
      event_type: "channel_owner_updated",
      channel_id: channelId,
      payload: {
        owner_name: data.owner_name,
        owner_identifier: data.owner_identifier,
      },
    });
    return json({ ok: true, channel: data });
  }
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
  try {
    return json(await runOperationalAudit(db));
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
