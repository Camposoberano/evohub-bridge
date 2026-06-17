// channel-sync — consulta o EVO Hub e ATUALIZA status/phone_number_id/waba dos canais
// na nossa base (pending->active quando conecta, e detecta queda). Pro botão "Atualizar"
// do painel + loop periódico. Auth: JWT do dashboard (no handler) ou interno (loop).
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { getChannelDetail } from "../shared/hub.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

// Sincroniza todos os canais (ou um tipo). Devolve resumo.
export async function syncChannels(db: Db, type?: string): Promise<Json> {
  let q = db.from("channels").select("id,name,type,status,hub_channel_id,phone_number_id").not("hub_channel_id", "is", null);
  if (type) q = q.eq("type", type);
  const { data: channels } = await q;
  let updated = 0;
  const changes: string[] = [];
  for (const ch of channels ?? []) {
    try {
      const det = (await getChannelDetail(ch.hub_channel_id as string)) as Json | null;
      if (!det) continue;
      const conn = (det.whatsapp_connection ?? det.facebook_connection ?? det.instagram_connection ?? det.meta_connection ?? {}) as Json;
      const phones = (conn.phone_numbers ?? []) as Json[];
      const p = (phones[0] ?? {}) as Json;
      const status = (det.status as string) ?? ch.status;
      const pnid = (conn.phone_number_id as string) ?? (p.id as string) ?? (det.phone_number_id as string) ?? null;
      const waba = (conn.waba_id as string) ?? (det.waba_id as string) ?? null;
      const patch: Json = {};
      if (status && status !== ch.status) patch.status = status;
      if (pnid && pnid !== ch.phone_number_id) patch.phone_number_id = pnid;
      if (waba) patch.waba_id = waba;
      if (p.display_phone_number) patch.phone_number = p.display_phone_number;
      if (p.verified_name) patch.display_name = p.verified_name;
      if (status === "active" && ch.status !== "active") patch.connected_at = new Date().toISOString();
      if (Object.keys(patch).length) {
        await db.from("channels").update(patch).eq("id", ch.id);
        updated++;
        if (patch.status) changes.push(`${ch.name}: ${ch.status}→${patch.status}`);
      }
    } catch (_) { /* ignora canal com erro */ }
  }
  return { total: channels?.length ?? 0, updated, changes };
}

export async function handle(req: Request): Promise<Response> {
  // interno (loop) passa ?token=; dashboard passa JWT.
  const url = new URL(req.url);
  const internal = url.searchParams.get("token") === env("CHATWOOT_WEBHOOK_SECRET");
  if (!internal) {
    const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
      auth: { persistSession: false },
    });
    if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);
  }
  const type = url.searchParams.get("type") ?? undefined;
  const res = await syncChannels(admin(), type);
  return json(res);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
