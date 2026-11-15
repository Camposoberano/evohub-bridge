// jev — classifica texto livre numa das opções via TypeSafe System One (Jev). Portado do hub CECAPE.
// Jev é modelo de JULGAMENTO (não chatbot). Aqui faz uma pergunta Choice com as opções do nó e
// devolve a opção + confiança. Chave ausente OU erro OU HTTP ruim → {choice:null} → o chamador
// cai no fallback (humano). NUNCA lança — degradar é a regra.
import { optionalEnv } from "./env.ts";

export type JevOpcao = { id: string; titulo?: string; descricao?: string };
export type AiConfig = { instrucao?: string; opcoes?: JevOpcao[]; minConfianca?: number; timeoutMs?: number };

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export async function classificarComJev(
  texto: string,
  cfg: AiConfig,
): Promise<{ choice: string | null; confidence: number }> {
  const key = optionalEnv("TYPESAFE_API_KEY");
  if (!key || !cfg?.opcoes?.length || !texto?.trim()) {
    if (!key) console.warn("jev: TYPESAFE_API_KEY ausente — caindo no fallback");
    return { choice: null, confidence: 0 };
  }
  const criteria: Record<string, string> = {};
  for (const o of cfg.opcoes) criteria[o.id] = o.descricao?.trim() || o.titulo?.trim() || o.id;
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      signal: cfg.timeoutMs ? AbortSignal.timeout(cfg.timeoutMs) : undefined,
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        state: texto,
        model: "jev-latest",
        questions: {
          intent: {
            type: "choice",
            instructions: cfg.instrucao?.trim() || "Qual opção descreve melhor a mensagem do cliente?",
            criteria,
          },
        },
      }),
    });
    if (!r.ok) {
      console.error("jev: HTTP", r.status, (await r.text().catch(() => "")).slice(0, 160));
      return { choice: null, confidence: 0 };
    }
    const j = await r.json().catch(() => null);
    const a = j?.answers?.intent;
    if (a?.type !== "choice" || typeof a.choice !== "string") return { choice: null, confidence: 0 };
    return { choice: a.choice, confidence: Number(a.confidence ?? 0) };
  } catch (e) {
    console.error("jev erro:", e instanceof Error ? e.message : String(e));
    return { choice: null, confidence: 0 };
  }
}
