import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env } from "../shared/env.ts";
import { admin } from "../shared/supabase.ts";
import { getHybridRoute } from "../shared/hybrid.ts";
import { listInstances, uazapiConfigured } from "../shared/uazapi.ts";
import {
  configuredChannel,
  readHybridConfig,
  setHybridChannelConfig,
} from "../shared/hybrid-config.ts";

type Json = Record<string, unknown>;

async function authenticatedUser(req: Request): Promise<Json | null> {
  const client = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
    auth: { persistSession: false },
  });
  return (await client.auth.getUser()).data?.user as Json | null;
}

export async function handle(req: Request): Promise<Response> {
  const user = await authenticatedUser(req);
  if (!user) return json({ error: "unauthorized" }, 401);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({})) as Json;
    const channelId = String(body.channel_id ?? "").trim();
    if (!channelId) return json({ error: "channel_id obrigatório" }, 400);
    const { data: channel } = await admin().from("channels")
      .select("id,type,phone_number").eq("id", channelId).maybeSingle();
    if (!channel || channel.type !== "whatsapp") {
      return json({ error: "canal WhatsApp não encontrado" }, 404);
    }
    const enabled = body.enabled === true;
    const instance = String(body.instance ?? "").trim() || undefined;
    await setHybridChannelConfig(channelId, {
      enabled,
      instance,
      updatedBy: String(user.email ?? user.id ?? "dashboard"),
    });
    await admin().from("events").insert({
      source: "dashboard",
      event_type: enabled ? "hybrid_enabled" : "hybrid_disabled",
      channel_id: channelId,
      payload: { instance: instance ?? null, actor: user.id ?? null },
      occurred_at: new Date().toISOString(),
    });
  } else if (req.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }

  const db = admin();
  const [{ data: channels }, config, instances] = await Promise.all([
    db.from("channels").select(
      "id,name,phone_number_id,phone_number,display_name,type,status,last_error",
    )
      .eq("type", "whatsapp").not("phone_number_id", "is", null),
    readHybridConfig(true),
    uazapiConfigured() ? listInstances() : Promise.resolve([]),
  ]);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEvents } = await db.from("events")
    .select("channel_id,event_type,received_at,payload")
    .eq("source", "hybrid").gte("received_at", since)
    .order("received_at", { ascending: false }).limit(1000);

  const routes = [];
  for (const channel of channels ?? []) {
    const route = await getHybridRoute(
      channel.id as string,
      channel.phone_number_id as string,
      channel.phone_number as string,
    );
    const override = configuredChannel(config, channel.id as string);
    const events = (recentEvents ?? []).filter((event: Json) =>
      event.channel_id === channel.id
    );
    routes.push({
      channel_id: channel.id,
      channel_name: channel.name ?? channel.display_name,
      phone_number: channel.phone_number,
      phone_number_id: channel.phone_number_id,
      status: channel.status,
      last_error: channel.last_error,
      configured: override,
      effective_enabled: override ? override.enabled : route !== null,
      hybrid: route
        ? { instance: route.instance, provider: route.provider }
        : null,
      metrics_24h: {
        success: events.filter((event: Json) =>
          event.event_type === "send_success"
        ).length,
        fallback: events.filter((event: Json) =>
          event.event_type === "fallback_requested"
        ).length,
        last_event_at: events[0]?.received_at ?? null,
      },
    });
  }

  return json({
    routes,
    instances: instances.map(({ token: _token, ...rest }) => rest),
    config_updated_at: config.updatedAt ?? null,
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
