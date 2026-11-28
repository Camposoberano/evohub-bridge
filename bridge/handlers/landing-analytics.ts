import { admin, claimDelivery, releaseDelivery } from "../shared/supabase.ts";

const ALLOWED_ORIGINS = new Set([
  "https://soberano.pro",
  "https://www.soberano.pro",
]);

const ALLOWED_EVENTS = new Set([
  "landing_page_view",
  "landing_video_play",
  "landing_video_25",
  "landing_video_50",
  "landing_video_75",
  "landing_video_complete",
  "landing_whatsapp_click",
]);

const MAX_BODY_BYTES = 2048;

type LandingEvent = {
  event_id: string;
  event_name: string;
  session_id: string;
  route: string;
  source?: string;
  campaign_id?: string;
  ad_id?: string;
  adset_id?: string;
};

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return json({ ok: true }, 204);
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const origin = req.headers.get("Origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return json({ error: "origin not allowed" }, 403);

  const declaredLength = Number(req.headers.get("Content-Length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: "payload too large" }, 413);
  }

  let body: LandingEvent;
  try {
    body = JSON.parse(raw) as LandingEvent;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const eventName = String(body.event_name ?? "");
  const sessionId = String(body.session_id ?? "").toLowerCase();
  const eventId = String(body.event_id ?? "").toLowerCase();
  const route = String(body.route ?? "");
  if (!ALLOWED_EVENTS.has(eventName)) return json({ error: "invalid event" }, 400);
  if (!/^[a-f0-9]{16}$/.test(sessionId) || eventId !== `${sessionId}:${eventName}`) {
    return json({ error: "invalid event id" }, 400);
  }
  if (route !== "6836" && route !== "5895") return json({ error: "invalid route" }, 400);

  const campaignId = safeMetaId(body.campaign_id);
  const adId = safeMetaId(body.ad_id);
  const adsetId = safeMetaId(body.adset_id);
  const source = safeSource(body.source);
  const deliveryId = `landing-funnel-${eventId}`;
  const db = admin();
  let claimed = false;

  try {
    claimed = await claimDelivery(db, deliveryId, "landing-funnel");
    if (!claimed) return json({ ok: true, duplicate: true }, 200);

    const payload = {
      event_id: eventId,
      session_id: sessionId,
      route,
      source,
      campaign_id: campaignId,
      ad_id: adId,
      adset_id: adsetId,
    };
    const { error } = await db.from("events").insert({
      source: "landing-funnel",
      event_type: eventName,
      payload,
      occurred_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ ok: true }, 202);
  } catch (error) {
    if (claimed) await releaseDelivery(db, deliveryId).catch(() => {});
    console.error("landing-funnel event write failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "event unavailable" }, 503);
  }
}

function safeMetaId(value: unknown): string | null {
  const id = String(value ?? "");
  return /^[0-9]{1,24}$/.test(id) ? id : null;
}

function safeSource(value: unknown): string | null {
  const source = String(value ?? "").toLowerCase();
  return /^(fb|ig|paid_social)$/.test(source) ? source : null;
}

function json(body: unknown, status: number): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
