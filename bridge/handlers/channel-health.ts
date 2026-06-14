// channel-health — saúde dos canais p/ o dashboard. Pra WhatsApp (API Oficial Meta)
// devolve quality_rating / status do número (anti-ban real; NÃO há proxy na API oficial).
// Auth: JWT do usuário do dashboard (igual connect-channel).
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { getChannelDetail } from "../shared/hub.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  const authz = req.headers.get("Authorization") ?? "";
  const userClient = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authz } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "unauthorized" }, 401);

  const db = admin();
  const { data: channels } = await db.from("channels")
    .select("id,name,type,status,hub_channel_id,phone_number,display_name").order("created_at", { ascending: false });

  const out = [];
  for (const ch of channels ?? []) {
    const item: Json = {
      id: ch.id, name: ch.name, type: ch.type, status: ch.status,
      display_name: ch.display_name, phone_number: ch.phone_number,
      quality_rating: null, number_status: null,
    };
    if (ch.type === "whatsapp" && ch.status === "active" && ch.hub_channel_id) {
      try {
        const detail = await getChannelDetail(ch.hub_channel_id as string) as Json | null;
        const mc = (detail?.meta_connection ?? {}) as Json;
        const phones = (mc.phone_numbers ?? []) as Json[];
        const p = phones[0] ?? {};
        item.quality_rating = p.quality_rating ?? null;
        item.number_status = p.status ?? null;
        item.phone_number = item.phone_number ?? p.display_phone_number ?? null;
        item.display_name = item.display_name ?? p.verified_name ?? null;
      } catch (_) { /* deixa null */ }
    }
    out.push(item);
  }

  return json({ channels: out });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
