// channel-health — saúde dos canais p/ o dashboard. Pra WhatsApp (API Oficial Meta)
// devolve quality_rating / status do número (anti-ban real; NÃO há proxy na API oficial).
// Pra Facebook/Instagram valida o channel_token na Graph: token de página expira em silêncio
// (26/08 o Atendimento IG ficou ~28h mudo com 401 e ninguém foi avisado).
// Auth: JWT do usuário do dashboard (igual connect-channel).
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { getChannelDetail, getMeta } from "../shared/hub.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const SOCIAL = new Set(["facebook", "instagram"]);

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
      quality_rating: null, number_status: null, token_ok: null, token_error: null,
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
    if (SOCIAL.has(String(ch.type)) && ch.status === "active") {
      Object.assign(item, await checkSocialToken(db, ch as Json));
    }
    out.push(item);
  }

  return json({ channels: out });
}

// Um GET barato em me?fields=id,name basta: token expirado devolve 401 com
// "Session has expired"; token válido devolve o id da página/conta.
async function checkSocialToken(db: ReturnType<typeof admin>, ch: Json): Promise<Json> {
  const { data: secret } = await db.from("channel_secrets")
    .select("channel_token").eq("channel_id", ch.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  if (!token) return { token_ok: false, token_error: "canal sem token" };

  try {
    const res = await getMeta(token, "me?fields=id,name");
    if (res.ok) {
      const d = (res.data ?? {}) as Json;
      return { token_ok: true, token_error: null, display_name: ch.display_name ?? d.name ?? null };
    }
    const detail = JSON.stringify(res.data).slice(0, 240);
    // 401/190 = token morto: precisa reconectar a página. Registra pra virar alerta.
    if (res.status === 401 || res.status === 403) {
      await db.from("events").insert({
        source: "channel-health",
        event_type: "channel_token_expired",
        channel_id: ch.id,
        payload: { canal: ch.name, tipo: ch.type, status: res.status, detail },
      }).then(() => {}, () => {});
    }
    return { token_ok: false, token_error: `Meta ${res.status}: ${detail}` };
  } catch (e) {
    return { token_ok: null, token_error: e instanceof Error ? e.message : String(e) };
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
