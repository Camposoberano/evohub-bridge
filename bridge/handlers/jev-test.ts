// jev-test — verificação de 1 clique do Jev (TypeSafe) pelo painel. Diz se a TYPESAFE_API_KEY
// está setada e se a classificação volta de verdade (chave válida) ou degrada pro fallback
// (chave ausente/ruim). Não expõe a chave. Auth: JWT do painel. Portado do hub CECAPE.
//   POST /jev-test  { texto?, opcoes?, instrucao? }  -> roda uma classificação de amostra
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classificarComJev, type JevOpcao } from "../shared/jev.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function handle(req: Request): Promise<Response> {
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  const { data } = await uc.auth.getUser();
  if (!data?.user) return json({ error: "unauthorized" }, 401);

  const keyPresent = Boolean(optionalEnv("TYPESAFE_API_KEY"));
  const body = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as Record<string, unknown>;

  const texto = typeof body.texto === "string" && body.texto.trim()
    ? body.texto
    : "quero saber o preço e como faço pra comprar";
  const opcoes = (Array.isArray(body.opcoes) && body.opcoes.length
    ? body.opcoes
    : [
      { id: "comprar", titulo: "Comprar", descricao: "quer comprar, fechar, fazer o pedido, formas de pagamento" },
      { id: "info", titulo: "Informação", descricao: "pergunta geral sobre o produto/serviço, preço, dúvidas" },
      { id: "outro", titulo: "Outro", descricao: "não é compra nem informação" },
    ]) as JevOpcao[];
  const instrucao = typeof body.instrucao === "string" ? body.instrucao : "Classifique a intenção da mensagem do cliente.";

  const t0 = Date.now();
  const r = await classificarComJev(texto, { instrucao, opcoes, minConfianca: 0.6 });
  const ms = Date.now() - t0;

  // keyPresent + choice != null = chave OK e classificou. keyPresent + choice null = chave
  // ruim/erro de API (ver Logs). sem key = fallback (nó IA sempre cai no humano).
  const status = !keyPresent
    ? "sem-chave"
    : r.choice != null
    ? "ok"
    : "chave-presente-mas-sem-resposta";
  return json({
    keyPresent,
    status,
    texto,
    choice: r.choice,
    confidence: r.confidence,
    ms,
    opcoes: opcoes.map((o) => ({ id: o.id, titulo: o.titulo })),
  });
}
