// clientes — painel de prospecção (tabela clientes, lista fria importada + enriquecida via uazapi).
// Auth: JWT do dashboard. Lê do banco principal (admin); multi-cliente fica pra depois.
//
// Diferença pra "contatos": clientes = lista fria, ainda sem conversa, alvo de disparo.
// contacts = quem já respondeu de verdade no canal oficial. Não se fundem -- mas um cliente
// enriquecido (on_whatsapp=true) precisa poder ser usado como público de Disparos, por isso
// o endpoint export=1 abaixo: devolve só os telefones confirmados, prontos pra campanha.
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { ufFromPhone } from "../shared/ddd.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

const UF_SCAN_CAP = 30_000; // limite de linhas escaneadas pra UF/filtro -- acima disso vira lento

export async function handle(req: Request): Promise<Response> {
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);

  const db = admin();
  const url = new URL(req.url);

  // stats (cards do topo) + breakdown por estado (UF) -- sempre olha a base toda, não a página.
  if (url.searchParams.get("stats") === "1") {
    const total = (await db.from("clientes").select("phone", { count: "exact", head: true })).count ?? 0;
    const wa = (await db.from("clientes").select("phone", { count: "exact", head: true }).eq("on_whatsapp", true)).count ?? 0;
    const done = (await db.from("clientes").select("phone", { count: "exact", head: true }).eq("enrich_status", "done")).count ?? 0;
    const noWa = (await db.from("clientes").select("phone", { count: "exact", head: true }).eq("enrich_status", "no_wa")).count ?? 0;
    // pendente = ainda no funil (não terminou fase 2 nem foi descartado por não ter WhatsApp).
    // Não usa enrich_status="pending" literal: esse valor só existe entre a importação e o
    // primeiro passo do loop (fase 1) -- some rápido, contava sempre ~0.
    const pending = Math.max(0, total - done - noWa);

    const { data: waRows } = await db.from("clientes").select("phone").eq("on_whatsapp", true).limit(UF_SCAN_CAP);
    const porUfMap = new Map<string, number>();
    for (const r of waRows ?? []) {
      const uf = ufFromPhone((r as Json).phone as string);
      if (uf) porUfMap.set(uf, (porUfMap.get(uf) ?? 0) + 1);
    }
    const porUf = [...porUfMap.entries()].sort((a, b) => b[1] - a[1]).map(([uf, count]) => ({ uf, count }));

    return json({ total, on_whatsapp: wa, enriquecidos: done, pendentes: pending, por_uf: porUf });
  }

  // export (pra Disparos/Campanhas): só telefones confirmados no WhatsApp, opcionalmente por UF.
  // Não devolve dado pessoal além do necessário pra disparar.
  if (url.searchParams.get("export") === "1") {
    const uf = (url.searchParams.get("uf") ?? "").toUpperCase();
    const { data } = await db.from("clientes").select("phone").eq("on_whatsapp", true).limit(UF_SCAN_CAP);
    const phones = (data ?? [])
      .map((r: Json) => r.phone as string)
      .filter((phone: string) => !uf || ufFromPhone(phone) === uf);
    return json({ phones, total: phones.length });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? "50"));
  const search = (url.searchParams.get("q") ?? "").trim();
  const onlyWa = url.searchParams.get("wa") === "1";
  const source = url.searchParams.get("source") ?? "";
  const uf = (url.searchParams.get("uf") ?? "").toUpperCase();

  let rows: Json[];
  let total: number;

  if (uf) {
    // UF não é coluna do banco (deriva do telefone) -- escaneia e pagina em memória.
    let scan = db.from("clientes")
      .select("phone,on_whatsapp,wa_name,wa_contact_name,verified_name,image_preview,source_number,common_groups,lead_tags,enrich_status")
      .order("on_whatsapp", { ascending: false, nullsFirst: false })
      .limit(UF_SCAN_CAP);
    if (search) scan = scan.or(`phone.ilike.%${search}%,wa_name.ilike.%${search}%,wa_contact_name.ilike.%${search}%,verified_name.ilike.%${search}%`);
    if (onlyWa) scan = scan.eq("on_whatsapp", true);
    if (source) scan = scan.eq("source_number", source);
    const { data, error } = await scan;
    if (error) return json({ error: error.message }, 500);
    const filtered = ((data ?? []) as Json[]).filter((c) => ufFromPhone(c.phone as string) === uf);
    total = filtered.length;
    rows = filtered.slice((page - 1) * limit, page * limit);
  } else {
    let q = db.from("clientes")
      .select("phone,on_whatsapp,wa_name,wa_contact_name,verified_name,image_preview,source_number,common_groups,lead_tags,enrich_status", { count: "exact" })
      .order("on_whatsapp", { ascending: false, nullsFirst: false })
      .range((page - 1) * limit, page * limit - 1);
    if (search) q = q.or(`phone.ilike.%${search}%,wa_name.ilike.%${search}%,wa_contact_name.ilike.%${search}%,verified_name.ilike.%${search}%`);
    if (onlyWa) q = q.eq("on_whatsapp", true);
    if (source) q = q.eq("source_number", source);
    const { data, count, error } = await q;
    if (error) return json({ error: error.message }, 500);
    rows = (data ?? []) as Json[];
    total = count ?? 0;
  }

  // marca quem já é contato real (já conversou via canal oficial) -- evita disparar
  // campanha de prospecção pra quem já está em atendimento.
  const { data: contactRows } = await db.from("contacts").select("phone,external_contact_id").limit(20000);
  const contactSet = new Set(
    (contactRows ?? []).map((c: Json) => last11((c.phone as string) ?? (c.external_contact_id as string))),
  );
  const clientes = rows.map((c) => ({ ...c, uf: ufFromPhone(c.phone as string), is_contact: contactSet.has(last11(c.phone as string)) }));

  return json({ clientes, total, page, limit });
}

// últimos 11 dígitos (DDD + número), ignora código do país -- compara telefones em formatos diferentes.
function last11(raw?: string | null): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-11);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
