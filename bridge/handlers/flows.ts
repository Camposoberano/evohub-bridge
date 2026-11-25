// flows — biblioteca de fluxos (flow_definitions) + versões imutáveis (flow_versions).
// Portado do hub CECAPE. Auth: JWT do dashboard (mesmo padrão de meta-templates). Leitura o
// painel faz direto no Supabase (RLS); aqui ficam as ESCRITAS (service_role): salvar rascunho,
// publicar versão.
//
//   GET  /flows            -> lista definições
//   GET  /flows?id=<id>    -> uma definição + suas versões
//   POST {action:"save", id?, name, description?, graph}   -> cria/atualiza rascunho
//   POST {action:"publish", id}                            -> valida + grava versão imutável
//   POST {action:"archive"|"unarchive", id}                -> muda status
import { admin } from "../shared/supabase.ts";
import { env } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.119.2";
import { type Flow, validateFlow } from "../shared/flow.ts";

type Json = Record<string, unknown>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** sha-256 hex de um graph canônico — identifica o conteúdo da versão. */
async function checksumDe(graph: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(graph));
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handle(req: Request): Promise<Response> {
  // Autentica o usuário do painel pelo JWT.
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data: userData } = await uc.auth.getUser();
  const user = userData?.user;
  if (!user) return json({ error: "unauthorized" }, 401);

  const db = admin();

  if (req.method === "GET") {
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      const { data: def, error } = await db.from("flow_definitions")
        .select("id,name,description,status,graph_json,current_version,updated_at")
        .eq("id", id).maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!def) return json({ error: "fluxo não encontrado" }, 404);
      const { data: versions } = await db.from("flow_versions")
        .select("version,checksum,published_at").eq("flow_id", id)
        .order("version", { ascending: false });
      // Grafo da versão PUBLICADA (pra disparar o fluxo no ar, não o rascunho). O painel não lê
      // flow_versions direto (RLS), então entregamos aqui.
      let published_graph: unknown = null;
      if (def.current_version) {
        const { data: pv } = await db.from("flow_versions")
          .select("graph_json").eq("flow_id", id).eq("version", def.current_version).maybeSingle();
        published_graph = pv?.graph_json ?? null;
      }
      return json({ definition: def, versions: versions ?? [], published_graph });
    }
    const { data, error } = await db.from("flow_definitions")
      .select("id,name,description,status,current_version,updated_at")
      .order("updated_at", { ascending: false });
    if (error) return json({ error: error.message }, 500);
    return json({ flows: data ?? [] });
  }

  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const body = await req.json().catch(() => ({})) as Json;
  const action = String(body.action ?? "");

  if (action === "save") {
    const name = String(body.name ?? "").trim();
    if (!name) return json({ error: "name obrigatório" }, 400);
    const graph = (body.graph ?? { steps: [] }) as Flow;
    const id = body.id ? String(body.id) : null;
    const now = new Date().toISOString();
    if (id) {
      const { data, error } = await db.from("flow_definitions")
        .update({ name, description: body.description ?? null, graph_json: graph, updated_at: now })
        .eq("id", id).select("id").maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "fluxo não encontrado" }, 404);
      return json({ ok: true, id: data.id });
    }
    const { data, error } = await db.from("flow_definitions")
      .insert({ name, description: body.description ?? null, graph_json: graph, status: "draft", created_by: user.id })
      .select("id").single();
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, id: data.id });
  }

  if (action === "publish") {
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id obrigatório" }, 400);
    const { data: def, error } = await db.from("flow_definitions")
      .select("id,graph_json").eq("id", id).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!def) return json({ error: "fluxo não encontrado" }, 404);

    const graph = def.graph_json as Flow;
    // Validação server-side é a que vale: fluxo inválido NÃO publica.
    const problemas = validateFlow(graph);
    if (problemas.length) return json({ error: "fluxo inválido", problemas }, 400);

    const checksum = await checksumDe(graph);
    // Próxima versão = maior + 1.
    const { data: ultima } = await db.from("flow_versions")
      .select("version,checksum").eq("flow_id", id)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (ultima?.checksum === checksum) {
      return json({ ok: true, inalterado: true, version: ultima.version, aviso: "nada mudou desde a última versão" });
    }
    const version = (ultima?.version ?? 0) + 1;
    const { error: vErr } = await db.from("flow_versions").insert({
      flow_id: id, version, graph_json: graph, checksum, published_by: user.id,
    });
    if (vErr) return json({ error: vErr.message }, 500);
    await db.from("flow_definitions")
      .update({ status: "published", current_version: version, updated_at: new Date().toISOString() })
      .eq("id", id);
    return json({ ok: true, version, checksum });
  }

  if (action === "archive" || action === "unarchive") {
    const id = String(body.id ?? "");
    if (!id) return json({ error: "id obrigatório" }, 400);
    const status = action === "archive" ? "archived" : "draft";
    const { error } = await db.from("flow_definitions")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, status });
  }

  return json({ error: "ação desconhecida" }, 400);
}
