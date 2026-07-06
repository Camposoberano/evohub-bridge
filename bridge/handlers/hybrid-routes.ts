// hybrid-routes — visualiza as rotas híbridas auto-descobertas (canal oficial ↔ uazapi).
// GET retorna canais oficiais, instâncias uazapi e quais casaram por número.
// Auth: JWT do dashboard OU ?token=CHATWOOT_WEBHOOK_SECRET.
import { env } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getHybridRoute } from "../shared/hybrid.ts";
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

  const db = admin();
  const { data: channels } = await db.from("channels")
    .select("id,name,phone_number_id,phone_number,display_name,type,status")
    .eq("type", "whatsapp").not("phone_number_id", "is", null);
  const instances = uazapiConfigured() ? await listInstances() : [];

  const routes: Json[] = [];
  for (const ch of channels ?? []) {
    const route = await getHybridRoute(ch.id as string, ch.phone_number_id as string, ch.phone_number as string);
    routes.push({
      channel_id: ch.id,
      channel_name: ch.name ?? ch.display_name,
      phone_number: ch.phone_number,
      phone_number_id: ch.phone_number_id,
      status: ch.status,
      hybrid: route ? { instance: route.instance, provider: route.provider } : null,
    });
  }

  return json({
    routes,
    instances: instances.map(({ token: _t, ...rest }) => rest),
  });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
