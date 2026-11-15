// audiences — Públicos: tabelas nomeadas de contatos, com colunas livres e escrita auditada.
// Portado do hub CECAPE (versão enxuta: sem verify-batch de WhatsApp — enhancement futuro).
//
//   GET  /audiences                       -> lista os públicos (com contagem)
//   GET  /audiences?id=<id>               -> um público + seus contatos
//   GET  /audiences?id=<id>&limit=..      -> página de contatos (busca em todas as células)
//   GET  /audiences?id=<id>&history_phone=.. -> trilha de edição de um contato
//   POST {action:"save", name, tag?, columns?, contacts:[{phone,name?,attributes?}]}
//   POST {action:"update"|"delete", id, ...}
//   POST {action:"add-column"|"rename-column"|"remove-column", id, ...}
//   POST {action:"set-contact"|"remove-contact"|"add-contacts", id, ...}
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type AudienceColumn, hasCorruptedAudienceText, makeAudienceColumn, validAudienceColumns } from "../shared/audience-columns.ts";

type Json = Record<string, unknown>;

function scalarAttributes(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key || key.length > 100 || raw !== null && typeof raw !== "string" && typeof raw !== "number") return null;
    if (String(raw ?? "").length > 2000) return null;
    result[key] = String(raw ?? "");
  }
  return result;
}

function columnsFromSchema(schema: AudienceColumn[]): string[] {
  return schema.filter((c) => c.active !== false).sort((a, b) => a.ordinal - b.ordinal).map((c) => c.title);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Normaliza o telefone pra chave de envio (dígitos, com DDI 55). 10-11 dígitos (DDD+local) ganham
 * o 55; 12-13 já têm país. Fora disso = inválido (descarta). Espelha a régua do disparo (>=12).
 */
function normFone(raw: string): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

/** Reconta os contatos do público e grava em contact_count. Devolve o novo total. */
async function recontar(db: ReturnType<typeof admin>, id: string): Promise<number> {
  const { count } = await db.from("audience_contacts")
    .select("id", { count: "exact", head: true }).eq("audience_id", id);
  const total = count ?? 0;
  await db.from("audiences").update({ contact_count: total }).eq("id", id);
  return total;
}

export async function handle(req: Request): Promise<Response> {
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: userData } = await uc.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "unauthorized" }, 401);
  const { data: allowed, error: policyError } = await uc.rpc("can_read_operational_campaigns");
  if (policyError) return json({ error: "falha ao verificar permissão" }, 500);
  if (allowed !== true) return json({ error: "acesso negado" }, 403);

  const db = admin();

  if (req.method === "GET") {
    const params = new URL(req.url).searchParams;
    const id = params.get("id");
    if (id) {
      const historyPhone = params.get("history_phone");
      if (historyPhone) {
        const phone = normFone(historyPhone);
        if (!phone) return json({ error: "telefone inválido" }, 400);
        const { data: history, error: historyError } = await db.from("audience_edit_log")
          .select("field_key,old_value,new_value,changed_at,changed_by")
          .eq("audience_id", id).eq("contact_phone", phone)
          .order("changed_at", { ascending: false }).limit(30);
        if (historyError) return json({ error: "falha ao consultar histórico" }, 500);
        return json({ history: history ?? [] });
      }
      const { data: aud, error } = await db.from("audiences")
        .select("id,name,tag,contact_count,columns,column_schema,schema_version,created_at").eq("id", id).maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!aud) return json({ error: "público não encontrado" }, 404);
      if (params.has("limit")) {
        const limit = Number(params.get("limit"));
        const offset = Number(params.get("offset") ?? 0);
        const query = params.get("q")?.trim() ?? "";
        const sort = params.get("sort") ?? "name";
        const desc = params.get("desc") === "1";
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
            !Number.isSafeInteger(offset) || offset < 0 || query.length > 80 ||
            !["name", "phone"].includes(sort)) return json({ error: "paginação inválida" }, 400);
        const { data: page, error: pageError } = await db.rpc("search_audience_contacts", {
          p_audience_id: id, p_query: query, p_limit: limit, p_offset: offset,
          p_sort: sort, p_desc: desc,
        });
        if (pageError) return json({ error: "falha ao consultar contatos" }, 500);
        const rows = (page ?? []) as Json[];
        return json({ audience: aud, contacts: rows.map(({ total_count: _count, ...contact }) => contact),
          total: Number(rows[0]?.total_count ?? 0), offset, limit });
      }
      const { data: contatos, error: contactsError } = await db.from("audience_contacts")
        .select("phone,name,attributes").eq("audience_id", id).order("name", { ascending: true });
      if (contactsError) return json({ error: "falha ao consultar contatos" }, 500);
      return json({ audience: aud, contacts: contatos ?? [] });
    }
    const { data, error } = await db.from("audiences")
      .select("id,name,tag,contact_count,created_at")
      .order("created_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ audiences: data ?? [] });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Json;
  const action = String(body.action ?? "");

  if (action === "save") {
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "nome do público obrigatório" }, 400);
    const tag = String(body.tag ?? "").trim() || null;
    const brutos = Array.isArray(body.contacts) ? body.contacts as Json[] : [];
    const titles = Array.isArray(body.columns) ? body.columns.map((c) => String(c).trim()) : [];
    const schema: AudienceColumn[] = [];
    try { for (const title of titles) schema.push(makeAudienceColumn(title, schema)); }
    catch (e) { return json({ error: e instanceof Error ? e.message : "coluna inválida" }, 400); }
    // Normaliza + dedupe por telefone (o último nome vence). Descarta telefone inválido.
    const porFone = new Map<string, { name: string | null; attributes: Record<string, string> }>();
    let invalidos = 0;
    for (const c of brutos) {
      const fone = normFone(String(c.phone ?? ""));
      if (!fone) { invalidos++; continue; }
      const nome = String(c.name ?? "").trim() || null;
      if (nome?.includes("�")) return json({ error: "nome contém caractere inválido; corrija o CSV antes de salvar" }, 400);
      const rawAttrs = scalarAttributes(c.attributes ?? {});
      if (!rawAttrs) return json({ error: "atributos inválidos" }, 400);
      if (hasCorruptedAudienceText(nome, rawAttrs)) {
        return json({ error: "texto contém caractere �; confira o CSV original antes de salvar" }, 400);
      }
      const attributes = Object.fromEntries(schema.map((col) => [col.key, rawAttrs[col.title] ?? ""]));
      if (!porFone.has(fone) || nome) porFone.set(fone, { name: nome, attributes });
    }
    if (!porFone.size) return json({ error: "nenhum telefone válido no CSV", invalidos }, 400);

    const { data: aud, error } = await db.from("audiences")
      .insert({ name, tag, contact_count: porFone.size, columns: titles, column_schema: schema, created_by: user.id })
      .select("id").single();
    if (error) return json({ error: error.message }, 500);

    const linhas = [...porFone].map(([phone, value]) => ({ audience_id: aud.id, phone, ...value }));
    // Insere em lotes pra não estourar o tamanho do request em CSV grande.
    for (let i = 0; i < linhas.length; i += 500) {
      const lote = linhas.slice(i, i + 500);
      const { error: cErr } = await db.from("audience_contacts")
        .upsert(lote, { onConflict: "audience_id,phone", ignoreDuplicates: true });
      if (cErr) {
        // Rollback best-effort: apaga o público pra não deixar meia-lista.
        await db.from("audiences").delete().eq("id", aud.id);
        return json({ error: `falha ao gravar contatos: ${cErr.message}` }, 500);
      }
    }
    return json({ ok: true, id: aud.id, salvos: porFone.size, invalidos });
  }

  if (action === "delete") {
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id obrigatório" }, 400);
    const { error } = await db.from("audiences").delete().eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "update") {
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id obrigatório" }, 400);
    const patch: Json = {};
    if (body.name !== undefined) {
      const nome = String(body.name).trim();
      if (!nome) return json({ error: "nome não pode ficar vazio" }, 400);
      patch.name = nome;
    }
    if (body.tag !== undefined) patch.tag = String(body.tag).trim() || null;
    if (body.columns !== undefined) return json({ error: "use ações de coluna para preservar chaves e valores" }, 400);
    if (!Object.keys(patch).length) return json({ error: "nada a atualizar" }, 400);
    const { error } = await db.from("audiences").update(patch).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "add-column" || action === "rename-column" || action === "remove-column") {
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id obrigatório" }, 400);
    const { data: aud, error: readError } = await db.from("audiences")
      .select("column_schema,schema_version").eq("id", id).maybeSingle();
    if (readError) return json({ error: "falha ao consultar colunas" }, 500);
    if (!aud) return json({ error: "tabela não encontrada" }, 404);
    const schema = aud.column_schema as AudienceColumn[];
    if (!validAudienceColumns(schema)) return json({ error: "esquema de colunas inválido" }, 500);
    let changed: AudienceColumn[];
    if (action === "add-column") {
      try { changed = [...schema, makeAudienceColumn(String(body.title ?? ""), schema)]; }
      catch (e) { return json({ error: e instanceof Error ? e.message : "coluna inválida" }, 400); }
    } else {
      const col = schema.find((c) => c.id === body.column_id && c.active !== false);
      if (!col) return json({ error: "coluna não encontrada" }, 404);
      if (action === "rename-column") {
        const title = String(body.title ?? "").trim();
        if (!title || title.length > 100 || title.includes("�") ||
          schema.some((c) => c.id !== col.id && c.active !== false && c.title.toLocaleLowerCase("pt-BR") === title.toLocaleLowerCase("pt-BR"))) {
          return json({ error: "título inválido ou repetido" }, 400);
        }
        changed = schema.map((c) => c.id === col.id ? { ...c, title } : c);
      } else changed = schema.map((c) => c.id === col.id ? { ...c, active: false } : c);
    }
    const { data: saved, error: writeError } = await db.from("audiences")
      .update({ column_schema: changed, columns: columnsFromSchema(changed), schema_version: Number(aud.schema_version) + 1 })
      .eq("id", id).eq("schema_version", aud.schema_version)
      .select("column_schema,schema_version").maybeSingle();
    if (writeError) return json({ error: "falha ao salvar coluna" }, 500);
    if (!saved) return json({ error: "tabela alterada em outra sessão; atualize e tente de novo" }, 409);
    return json({ ok: true, column_schema: saved.column_schema, schema_version: saved.schema_version });
  }

  // upsert de UMA linha da tabela (editar célula / adicionar pessoa). phone = chave da linha.
  if (action === "set-contact") {
    const id = String(body.id ?? "");
    const phone = normFone(String(body.phone ?? ""));
    if (!id || !phone) return json({ error: "id e telefone válidos obrigatórios" }, 400);
    const attrs = scalarAttributes(body.attributes ?? {});
    if (!attrs) return json({ error: "atributos inválidos ou valor acima de 2.000 caracteres" }, 400);
    if (hasCorruptedAudienceText(body.name, attrs)) {
      return json({ error: "texto contém caractere �; confira o original antes de salvar" }, 400);
    }
    const { error } = await db.rpc("save_audience_contact", {
      p_audience_id: id, p_phone: phone, p_name: String(body.name ?? "").trim() || null,
      p_attributes: attrs, p_actor: user.id,
    });
    if (error) return json({ error: error.message }, 500);
    const count = await recontar(db, id);
    return json({ ok: true, count });
  }

  if (action === "remove-contact") {
    const id = String(body.id ?? "");
    const phone = normFone(String(body.phone ?? "")) ?? String(body.phone ?? "");
    if (!id || !phone) return json({ error: "id e phone obrigatórios" }, 400);
    const { error } = await db.from("audience_contacts").delete().eq("audience_id", id).eq("phone", phone);
    if (error) return json({ error: error.message }, 500);
    const count = await recontar(db, id);
    return json({ ok: true, count });
  }

  if (action === "add-contacts") {
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id obrigatório" }, 400);
    const brutos = Array.isArray(body.contacts) ? body.contacts as Json[] : [];
    const porFone = new Map<string, string | null>();
    let invalidos = 0;
    for (const c of brutos) {
      const fone = normFone(String(c.phone ?? ""));
      if (!fone) { invalidos++; continue; }
      porFone.set(fone, String(c.name ?? "").trim() || null);
    }
    if (!porFone.size) return json({ error: "nenhum telefone válido", invalidos }, 400);
    const linhas = [...porFone].map(([phone, nome]) => ({ audience_id: id, phone, name: nome }));
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await db.from("audience_contacts")
        .upsert(linhas.slice(i, i + 500), { onConflict: "audience_id,phone", ignoreDuplicates: true });
      if (error) return json({ error: error.message }, 500);
    }
    const count = await recontar(db, id);
    return json({ ok: true, count, invalidos });
  }

  return json({ error: "ação desconhecida" }, 400);
}
