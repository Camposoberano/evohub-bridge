// clientes — painel de contatos (tabela clientes). Listagem paginada + busca + filtros + stats.
// Auth: JWT do dashboard. Lê do banco principal (admin); multi-cliente fica pra depois.
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);

  const db = admin();
  const url = new URL(req.url);

  // stats (cards do topo)
  if (url.searchParams.get("stats") === "1") {
    const total = (await db.from("clientes").select("phone", { count: "exact", head: true })).count ?? 0;
    const wa = (await db.from("clientes").select("phone", { count: "exact", head: true }).eq("on_whatsapp", true)).count ?? 0;
    const done = (await db.from("clientes").select("phone", { count: "exact", head: true }).eq("enrich_status", "done")).count ?? 0;
    const pending = (await db.from("clientes").select("phone", { count: "exact", head: true }).eq("enrich_status", "pending")).count ?? 0;
    return json({ total, on_whatsapp: wa, enriquecidos: done, pendentes: pending });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? "50"));
  const search = (url.searchParams.get("q") ?? "").trim();
  const onlyWa = url.searchParams.get("wa") === "1";
  const source = url.searchParams.get("source") ?? "";

  let q = db.from("clientes")
    .select("phone,on_whatsapp,wa_name,wa_contact_name,verified_name,image_preview,source_number,common_groups,lead_tags,enrich_status", { count: "exact" })
    .order("on_whatsapp", { ascending: false, nullsFirst: false })
    .range((page - 1) * limit, page * limit - 1);
  if (search) q = q.or(`phone.ilike.%${search}%,wa_name.ilike.%${search}%,wa_contact_name.ilike.%${search}%,verified_name.ilike.%${search}%`);
  if (onlyWa) q = q.eq("on_whatsapp", true);
  if (source) q = q.eq("source_number", source);

  const { data, count, error } = await q;
  if (error) return json({ error: error.message }, 500);
  return json({ clientes: data ?? [], total: count ?? 0, page, limit });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
