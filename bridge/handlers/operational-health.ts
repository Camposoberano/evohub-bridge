import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env, optionalEnv } from "../shared/env.ts";
import {
  admin,
  claimDeliveryWithTtl,
  type DbClient,
} from "../shared/supabase.ts";

type Json = Record<string, unknown>;

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
  const overdue = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const [
    channelsResult,
    failedMessages,
    overdueQueue,
    recentContacts,
    adConversations,
  ] = await Promise.all([
    db.from("channels").select(
      "id,name,type,status,phone_number,display_name,page_id,ig_id,owner_name,owner_identifier,last_error",
    ).order("name"),
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
    db.from("conversations").select("id,ad_id,creative_id,attribution")
      .eq("origem", "anuncio").gte("opened_at", since24h).limit(3000),
  ]);
  if (channelsResult.error) throw channelsResult.error;
  if (recentContacts.error) throw recentContacts.error;
  if (adConversations.error) throw adConversations.error;

  const channels = (channelsResult.data ?? []) as Json[];
  const contacts = (recentContacts.data ?? []) as Json[];
  const ads = (adConversations.data ?? []) as Json[];
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
  const disconnected =
    channels.filter((item) =>
      item.status !== "active" && item.status !== "connected"
    ).length;

  const issues = [
    { key: "channel_disconnected", severity: "critical", count: disconnected },
    { key: "failed_messages_24h", severity: "critical", count: failedMessages },
    { key: "overdue_funnel_queue", severity: "critical", count: overdueQueue },
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

  return {
    ok: !issues.some((issue) => issue.severity === "critical"),
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
