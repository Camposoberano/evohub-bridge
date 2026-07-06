// hybrid-routes — CRUD das rotas híbridas (canal oficial → instância uazapi espelho).
// Auth: JWT do dashboard.
import { env } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllRoutes, setRoute, type HybridRoute } from "../shared/hybrid.ts";
import { listInstances, uazapiConfigured } from "../shared/uazapi.ts";
import { admin } from "../shared/supabase.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token") ?? "";
  const internal = timingSafeEqual(tokenParam, env("CHATWOOT_WEBHOOK_SECRET"));
  if (!internal) {
    const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);
  }

  if (req.method === "GET") {
    const routes = await getAllRoutes();
    const db = admin();
    const { data: channels } = await db.from("channels")
      .select("id,name,phone_number_id,phone_number,display_name,type,status")
      .eq("type", "whatsapp").not("phone_number_id", "is", null);
    const instances = uazapiConfigured() ? await listInstances() : [];
    return json({
      routes,
      channels: (channels ?? []).map((c: Json) => ({
        id: c.id, name: c.name, phone_number_id: c.phone_number_id,
        phone_number: c.phone_number, display_name: c.display_name, status: c.status,
      })),
      instances: instances.map(({ token: _t, ...rest }) => rest),
    });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;

  if (action === "set") {
    const channelId = String(body.channel_id ?? "").trim();
    const instance = String(body.instance ?? "").trim();
    if (!channelId) return json({ error: "channel_id obrigatório" }, 400);
    if (!instance) {
      await setRoute(channelId, null);
      return json({ ok: true, removed: channelId, routes: await getAllRoutes() });
    }
    const route: HybridRoute = { provider: "uazapi", instance, enabled: true };
    await setRoute(channelId, route);
    return json({ ok: true, routes: await getAllRoutes() });
  }

  if (action === "toggle") {
    const channelId = String(body.channel_id ?? "").trim();
    const routes = await getAllRoutes();
    const r = routes[channelId];
    if (!r) return json({ error: "rota não encontrada" }, 404);
    r.enabled = !(r.enabled ?? true);
    await setRoute(channelId, r);
    return json({ ok: true, routes: await getAllRoutes() });
  }

  return json({ error: "ação desconhecida: " + action }, 400);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
