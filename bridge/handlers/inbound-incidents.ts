import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env, optionalEnv } from "../shared/env.ts";
import {
  admin,
  claimDeliveryWithTtl,
  type DbClient,
  releaseDelivery,
  releaseDeliveryIfOlderThan,
} from "../shared/supabase.ts";
import {
  auditInboundIncidents,
  inbound5895AlertCandidates,
  inbound5895AlertKey,
  type InboundIncident,
} from "../shared/inbound-incidents.ts";
import { processInboundUazapiEvent } from "./uazapi-webhook.ts";
import { entregarAlertas } from "../shared/operational-alert.ts";

type Json = Record<string, unknown>;

async function authenticated(req: Request): Promise<boolean> {
  const token = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(token)) return false;
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: token } },
    auth: { persistSession: false },
  });
  return Boolean((await client.auth.getUser()).data?.user);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function replay(
  db: DbClient,
  incident: InboundIncident,
): Promise<{ ok: boolean; reason?: string }> {
  if (!incident.can_retry || !incident.channel_id) {
    return { ok: false, reason: "Revisão humana necessária" };
  }
  if (incident.state === "missing_message") {
    const claimKey = `wa-${incident.channel_id}-${incident.message_id}`;
    const { data: existing, error: claimError } = await db.from("deliveries")
      .select("received_at").eq("delivery_id", claimKey).maybeSingle();
    if (claimError) throw claimError;
    if (
      existing && Date.now() - Date.parse(existing.received_at) < 15 * 60_000
    ) {
      return {
        ok: false,
        reason: "Entrada ainda em processamento; tente depois",
      };
    }
  }
  const lock = `inbound-replay-${incident.event_id}`;
  if (!await claimDeliveryWithTtl(db, lock, "inbound-replay", 10 * 60_000)) {
    return { ok: false, reason: "Recuperação já em andamento" };
  }
  try {
    const { data: event, error } = await db.from("events")
      .select("id,payload").eq("id", incident.event_id).eq("source", "uazapi")
      .eq("event_type", "messages").maybeSingle();
    if (error) throw error;
    if (!event) return { ok: false, reason: "Evento original não encontrado" };
    if (incident.state === "missing_message") {
      // Claim órfão só pode ser solto depois de quinze minutos. O trabalho recente
      // permanece protegido contra gravação duplicada no Chatwoot.
      await releaseDeliveryIfOlderThan(
        db,
        `wa-${incident.channel_id}-${incident.message_id}`,
        15 * 60_000,
      );
    }
    await processInboundUazapiEvent(
      db,
      event.payload as Json,
      incident.event_id,
    );
    await db.from("events").insert({
      source: "inbound-watchdog",
      event_type: "inbound_replayed",
      channel_id: incident.channel_id,
      payload: { raw_event_id: incident.event_id, state: incident.state },
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.name : "Erro de processamento",
    };
  } finally {
    await releaseDelivery(db, lock).catch((e) =>
      console.error("inbound-replay: lock", e)
    );
  }
}

let lastFullAuditAt = 0;

export async function runInboundWatchdog(
  db: DbClient,
  now = new Date(),
): Promise<void> {
  const first = await auditInboundIncidents(db, 0.5, now);
  // O webhook já foi confirmado ao provedor; a recuperação rápida cobre somente
  // eventos recentes. Entradas antigas ficam no painel para revisão contextual.
  for (const incident of first.incidents) {
    if (!incident.can_retry) continue;
    if (now.getTime() - Date.parse(incident.received_at) < 2 * 60_000) continue;
    const result = await replay(db, incident);
    if (!result.ok) {
      console.warn(
        "inbound-watchdog: recuperação pendente",
        incident.event_id,
        result.reason,
      );
    }
  }
  const fullAudit = now.getTime() - lastFullAuditAt >= 15 * 60_000;
  const after = await auditInboundIncidents(
    db,
    fullAudit ? 72 : 0.5,
    new Date(),
  );
  if (fullAudit) lastFullAuditAt = now.getTime();
  const unresolved = after.incidents;
  if (!unresolved.length) return;
  // Alerta só o que ficou parado ALÉM da janela normal de processamento. A detecção (90s) e
  // o replay (2min) seguem iguais; só o ALERTA no WhatsApp espera mais, pra não pingar por
  // atraso transitório (webhook lento, Chatwoot 502/503, varredura/catch-up a cada 15min)
  // que se resolve sozinho. Em 24-25/10: 51/51 entradas do 5895 processaram, mas o limiar de
  // 90s alertava ~11 por noite. Ajustável por INBOUND_ALERT_MIN_AGE_MS.
  const alertAgeMs = Number(optionalEnv("INBOUND_ALERT_MIN_AGE_MS")) || 8 * 60_000;
  const alertaveis = unresolved.filter((incident) =>
    now.getTime() - Date.parse(incident.received_at) >= alertAgeMs
  );
  if (!alertaveis.length) return;
  const manual = new Set<string>();
  if (alertaveis.some((incident) => incident.channel === "5895")) {
    const { data, error } = await db.from("events").select("payload")
      .eq("source", "inbound-watchdog")
      .eq("event_type", "inbound_incident_manual")
      .gte("received_at", new Date(now.getTime() - 72 * 60 * 60_000).toISOString())
      .order("received_at", { ascending: false }).limit(2000);
    if (error) throw error;
    for (const event of data ?? []) {
      const id = String((event.payload as Json)?.raw_event_id ?? "");
      if (id) manual.add(id);
    }
  }
  for (const incident of inbound5895AlertCandidates(alertaveis, manual)) {
    await entregarAlertas(db, [{
      key: "inbound_unprocessed",
      severity: "critical",
      count: 1,
      detail: `${incident.channel} ${incident.contact_suffix}: ${incident.state}`,
    }], new Date(), {
      dedupeKey: inbound5895AlertKey(incident.event_id),
      ttlMs: 72 * 60 * 60_000,
    });
  }
  const others = alertaveis.filter((incident) => incident.channel !== "5895");
  if (!others.length) return;
  const detail = others.slice(0, 4).map((incident) =>
    `${incident.channel} ${incident.contact_suffix}: ${incident.state}`
  ).join("; ");
  await entregarAlertas(db, [{
    key: "inbound_unprocessed",
    severity: "critical",
    count: others.length,
    detail,
  }], new Date());
}

export async function handle(req: Request): Promise<Response> {
  if (!(await authenticated(req))) return json({ error: "unauthorized" }, 401);
  const db = admin();
  if (req.method === "GET") {
    try {
      return json(await auditInboundIncidents(db));
    } catch (error) {
      console.error("inbound-incidents GET", error);
      return json({ error: "Falha ao consultar entradas" }, 500);
    }
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const body = await req.json().catch(() => ({})) as Json;
  const eventId = String(body.event_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
    return json({ error: "event_id inválido" }, 400);
  }
  try {
    const audit = await auditInboundIncidents(db);
    const incident = audit.incidents.find((item) => item.event_id === eventId);
    if (!incident) {
      return json({ error: "Pendência já resolvida ou fora da janela" }, 409);
    }
    const result = await replay(db, incident);
    if (!result.ok) return json({ error: result.reason }, 409);
    const fresh = await auditInboundIncidents(db);
    const remaining = fresh.incidents.find((item) => item.event_id === eventId);
    return json(
      { ok: !remaining, incident: remaining ?? null },
      remaining ? 409 : 200,
    );
  } catch (error) {
    console.error("inbound-incidents POST", error);
    return json({ error: "Falha ao recuperar entrada" }, 500);
  }
}
