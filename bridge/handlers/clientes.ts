// clientes — painel de prospecção (tabela clientes, lista fria importada + enriquecida via uazapi).
// Auth: JWT do dashboard. Lê do banco principal (admin); multi-cliente fica pra depois.
//
// Diferença pra "contatos": clientes = lista fria, ainda sem conversa, alvo de disparo.
// contacts = quem já respondeu de verdade no canal oficial. Não se fundem -- mas um cliente
// já enriquecido (enrich_status != "pending") precisa poder ser usado como público de
// Disparos, por isso o endpoint export=1 abaixo: devolve os telefones já processados.
// Não filtra por on_whatsapp=true: o check do uazapi pode estar errado/desatualizado,
// e travar nele perde gente que na real continua tendo WhatsApp.
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { ufFromPhone } from "../shared/ddd.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
type QueryBuilder = PromiseLike<{ data: unknown; error: unknown }> & { range: (a: number, b: number) => any };

const UF_SCAN_CAP = 30_000; // limite de linhas escaneadas pra UF/filtro -- acima disso vira lento

// PostgREST limita a 1000 linhas por resposta por padrão, MESMO pedindo .limit() maior no
// código -- corta sozinho. Pagina em lotes de 1000 até esgotar ou bater o cap.
async function scanAll(build: (from: number, to: number) => QueryBuilder, cap = UF_SCAN_CAP): Promise<Json[]> {
  const BATCH = 1000;
  const out: Json[] = [];
  for (let from = 0; from < cap; from += BATCH) {
    const to = Math.min(from + BATCH, cap) - 1;
    const { data, error } = await build(from, to);
    if (error) throw error;
    const rows = (data ?? []) as Json[];
    out.push(...rows);
    if (rows.length < (to - from + 1)) break; // última página, não veio lote cheio
  }
  return out;
}

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

    // base de disparo = todo enriquecido (saiu de "pending"), não só on_whatsapp=true --
    // o check do uazapi pode estar errado/desatualizado, não trava o público por causa disso.
    let waRows: Json[];
    try {
      waRows = await scanAll((from, to) => db.from("clientes").select("phone").neq("enrich_status", "pending").range(from, to));
    } catch (e) { return json({ error: String(e) }, 500); }
    const porUfMap = new Map<string, number>();
    let semUf = 0;
    for (const r of waRows) {
      const uf = ufFromPhone(r.phone as string);
      if (uf) porUfMap.set(uf, (porUfMap.get(uf) ?? 0) + 1);
      else semUf++; // telefone em formato que não bate com nenhum DDD conhecido -- não desaparece, só não agrupa
    }
    const porUf = [...porUfMap.entries()].sort((a, b) => b[1] - a[1]).map(([uf, count]) => ({ uf, count }));

    return json({ total, on_whatsapp: wa, enriquecidos: done, pendentes: pending, por_uf: porUf, sem_uf: semUf, enriquecidos_total: waRows.length });
  }

  // export (pra Disparos/Campanhas): todo enriquecido (saiu de "pending"), opcionalmente por UF.
  // Não filtra por on_whatsapp=true -- o check pode estar errado/desatualizado, não trava o público por causa disso.
  if (url.searchParams.get("export") === "1") {
    const uf = (url.searchParams.get("uf") ?? "").toUpperCase();
    let data: Json[];
    try {
      data = await scanAll((from, to) => db.from("clientes").select("phone").neq("enrich_status", "pending").range(from, to));
    } catch (e) { return json({ error: String(e) }, 500); }
    const phones = data
      .map((r) => r.phone as string)
      .filter((phone) => !uf || ufFromPhone(phone) === uf);
    return json({ phones, total: phones.length });
  }

  // "selecionar todos os X filtrados" no painel -- só telefones, respeita os mesmos filtros da lista.
  if (url.searchParams.get("allphones") === "1") {
    const search = (url.searchParams.get("q") ?? "").trim();
    const onlyWa = url.searchParams.get("wa") === "1";
    const source = url.searchParams.get("source") ?? "";
    const uf = (url.searchParams.get("uf") ?? "").toUpperCase();
    let data: Json[];
    try {
      data = await scanAll((from, to) => {
        let scan = db.from("clientes").select("phone").range(from, to);
        if (search) scan = scan.or(`phone.ilike.%${search}%,wa_name.ilike.%${search}%,wa_contact_name.ilike.%${search}%,verified_name.ilike.%${search}%`);
        if (onlyWa) scan = scan.eq("on_whatsapp", true);
        if (source) scan = scan.eq("source_number", source);
        return scan;
      });
    } catch (e) { return json({ error: String(e) }, 500); }
    const phones = data.map((r) => r.phone as string).filter((p) => !uf || ufFromPhone(p) === uf);
    return json({ phones, total: phones.length });
  }

  // ficha completa de 1 cliente (modal ao clicar na linha) -- todas as colunas, inclusive raw.
  const phoneParam = url.searchParams.get("phone");
  if (phoneParam) {
    const { data, error } = await db.from("clientes").select("*").eq("phone", phoneParam).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "não encontrado" }, 404);
    // busca direto pelo dígito (não escaneia a tabela toda) -- filtra no banco pelo sufixo do telefone.
    const phoneDigits = last11(phoneParam);
    const { data: contactRow } = await db.from("contacts").select("id,name,phone,external_contact_id,last_seen_at")
      .or(`phone.ilike.%${phoneDigits}%,external_contact_id.ilike.%${phoneDigits}%`);
    const contato = (contactRow ?? []).find((c: Json) => last11((c.phone as string) ?? (c.external_contact_id as string)) === phoneDigits) ?? null;
    return json({ ...(data as Json), uf: ufFromPhone(phoneParam), is_contact: !!contato, contato });
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
    // UF não é coluna do banco (deriva do telefone) -- escaneia tudo (paginado em lotes de
    // 1000, limite do PostgREST) e filtra/pagina em memória.
    let data: Json[];
    try {
      data = await scanAll((from, to) => {
        let scan = db.from("clientes")
          .select("phone,on_whatsapp,wa_name,wa_contact_name,verified_name,image_preview,source_number,common_groups,lead_tags,enrich_status")
          .order("on_whatsapp", { ascending: false, nullsFirst: false })
          .range(from, to);
        if (search) scan = scan.or(`phone.ilike.%${search}%,wa_name.ilike.%${search}%,wa_contact_name.ilike.%${search}%,verified_name.ilike.%${search}%`);
        if (onlyWa) scan = scan.eq("on_whatsapp", true);
        if (source) scan = scan.eq("source_number", source);
        return scan;
      });
    } catch (e) { return json({ error: String(e) }, 500); }
    const filtered = data.filter((c) => ufFromPhone(c.phone as string) === uf);
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
  // campanha de prospecção pra quem já está em atendimento. Escaneia tudo (paginado, limite
  // de 1000/req do PostgREST) -- só pra essa página de rows, então cap menor já basta.
  let contactRows: Json[];
  try {
    contactRows = await scanAll((from, to) => db.from("contacts").select("phone,external_contact_id").range(from, to), 20_000);
  } catch (e) { return json({ error: String(e) }, 500); }
  const contactSet = new Set(
    contactRows.map((c) => last11((c.phone as string) ?? (c.external_contact_id as string))),
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
