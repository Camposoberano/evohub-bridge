// Smoke test local para o fluxo /llm-orchestrate em mode=execute.
// Requisitos:
// - OPENAI_API_KEY presente no ambiente
// - bridge rodando localmente em http://localhost:8000
// - LLM_ROUTER_API_TOKEN obrigatório para autorizar a chamada

const base = Deno.env.get("BRIDGE_LOCAL_BASE") ?? "http://localhost:8000";
const token = Deno.env.get("LLM_ROUTER_API_TOKEN") ?? "";
if (!token) throw new Error("defina LLM_ROUTER_API_TOKEN para executar este smoke test");
const bundlePath = Deno.env.get("PROMPT_CACHE_BUNDLE_PATH") ?? ".ai-context/PROMPT_CACHE_BUNDLE.md";

let contextPrefix = "";
try {
  contextPrefix = await Deno.readTextFile(bundlePath);
} catch {
  contextPrefix = "";
}

const payload = {
  mode: "execute",
  area: "analysis",
  risk: "medium",
  title: "Smoke test prompt cache",
  objective: "validar execucao OpenAI com trilha de prompt caching",
  cache_tenant: "internal-smoke",
  payload: {
    context_prefix: contextPrefix,
    files: ["README.md", "bridge/handlers/llm-orchestrate.ts"],
  },
  instructions: "Responda com um resumo tecnico curto em portugues, com no maximo 3 linhas.",
};

const res = await fetch(`${base.replace(/\/+$/, "")}/llm-orchestrate`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log("status:", res.status);
console.log(text);
