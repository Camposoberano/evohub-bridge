// meta-templates — lista os templates do WhatsApp oficial (Meta Cloud) da WABA.
// Aprovou um template na Meta? Aparece aqui automático. Usa META_ACCESS_TOKEN + waba_id do canal.
// Auth: JWT do dashboard.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
const GRAPH = optionalEnv("META_GRAPH_VERSION") ?? "v21.0";

export async function handle(req: Request): Promise<Response> {
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);

  const token = optionalEnv("META_ACCESS_TOKEN");
  if (!token) return json({ error: "META_ACCESS_TOKEN ausente" }, 503);

  // WABA alvo. Template é POR WABA: um nome aprovado numa não existe na outra, e mandar o
  // nome errado devolve "(#132001) Template name does not exist in the translation" — foi o
  // erro de 03/08, com os templates criados na WABA errada. Sem `?waba=` isto pegava a
  // primeira linha que o banco devolvesse, sem ordenação: com mais de um número oficial,
  // listar e criar caíam num canal arbitrário.
  //
  // O id é validado contra os canais cadastrados em vez de repassado direto pra Graph —
  // este endpoint tem o META_ACCESS_TOKEN, então aceitar WABA arbitrária de quem chama
  // deixaria criar template em conta de terceiro.
  const { data: canais } = await admin().from("channels")
    .select("waba_id,phone_number,name")
    .eq("type", "whatsapp").not("waba_id", "is", null);
  const disponiveis = (canais ?? []) as Json[];
  if (!disponiveis.length) {
    return json({ error: "canal whatsapp sem waba_id" }, 404);
  }
  const pedido = new URL(req.url).searchParams.get("waba");
  const escolhido = pedido
    ? disponiveis.find((c) => String(c.waba_id) === pedido)
    : disponiveis[0];
  if (!escolhido) {
    return json({
      error: `waba ${pedido} não pertence a nenhum canal cadastrado`,
      disponiveis: disponiveis.map((c) => ({
        waba_id: c.waba_id,
        phone_number: c.phone_number,
        name: c.name,
      })),
    }, 404);
  }
  const waba = String(escolhido.waba_id);

  if (req.method === "POST") return create(req, token, waba);

  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${waba}/message_templates?limit=100&fields=name,language,status,category,components`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({})) as Json;
  if (!res.ok) return json({ error: "graph " + res.status, detail: data }, res.status);

  const templates = ((data.data ?? []) as Json[]).map((t) => ({
    name: t.name, language: t.language, status: t.status, category: t.category,
    hasMediaHeader: Array.isArray(t.components) && (t.components as Json[]).some((c) => c.type === "HEADER" && c.format && c.format !== "TEXT"),
    components: t.components,
  }));
  const approved = templates.filter((t) => t.status === "APPROVED");
  return json({
    waba,
    phone_number: escolhido.phone_number ?? null,
    total: templates.length,
    approved: approved.length,
    templates,
  });
}

// POST { name, language, category, body, buttons? } -> submete pra aprovação na Meta.
async function create(req: Request, token: string, waba: string): Promise<Response> {
  const p = await req.json().catch(() => ({})) as Json;
  const name = p.name as string | undefined;
  const language = (p.language as string) || "pt_BR";
  const category = (p.category as string) || "MARKETING";
  const body = p.body as string | undefined;
  const buttons = (p.buttons as { text: string }[] | undefined) ?? [];
  if (!name || !body) return json({ error: "name e body obrigatórios" }, 400);

  const components: Json[] = [{ type: "BODY", text: body }];
  if (buttons.length > 0) {
    components.push({ type: "BUTTONS", buttons: buttons.map((b) => ({ type: "QUICK_REPLY", text: b.text })) });
  }

  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, language, category, components }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return json({ error: "graph " + res.status, detail: data }, res.status);
  return json({ ok: true, ...data as Json });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
