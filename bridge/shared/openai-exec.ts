import { env, optionalEnv } from "./env.ts";
import {
  buildPromptCacheKey,
  buildPromptCacheRequest,
  cacheableTextBlock,
  extractPromptCacheMetrics,
  supportsExplicitPromptCaching,
} from "./prompt-cache.ts";

type Json = Record<string, unknown>;

export interface OpenAIExecInput {
  area: string;
  title: string;
  objective: string;
  input: string;
  model?: string;
  tenant?: string;
  cacheRevision?: string;
  contextPrefix?: string;
  instructions?: string;
  maxCompletionTokens?: number;
  temperature?: number;
}

export interface OpenAIExecResult {
  model: string;
  text: string;
  response: Json;
  promptCacheKey: string;
  promptCacheTtl: string | null;
  promptCacheMode: string | null;
  usage: ReturnType<typeof extractPromptCacheMetrics>;
}

const DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_CACHE_TTL = "30m";

// Prefixo estavel e reutilizavel do EvoHub. Pode ser combinado com um contexto
// adicional enviado pelo caller (bundle gerado externamente) para aumentar hit rate.
const DEFAULT_PROJECT_PREFIX = `
Voce esta operando dentro do projeto EvoHub.

Contexto de arquitetura:
- O bridge e a camada central de regra de negocio e integracao.
- O Chatwoot e a camada de atendimento e interface operacional.
- O Supabase e a base operacional, analitica e de auditoria.
- O dashboard Next.js consome o estado operacional e expõe ferramentas internas.
- Integracoes principais incluem EVO Hub, Uazapi e RyzeAPI para mensageria.

Principios de execucao:
- Preserve compatibilidade com a arquitetura existente.
- Prefira mudancas pequenas, localizadas e auditaveis.
- Nao invente novas abstrações sem necessidade clara.
- Reaproveite contratos, IDs e estruturas ja presentes no projeto.
- Saídas devem ser objetivas, tecnicas e voltadas à execução.

Convencoes de engenharia:
- Regras de negocio ficam no bridge, nunca espalhadas no Chatwoot.
- O Chatwoot funciona como camada de conversa, nao como orquestrador principal.
- O Supabase armazena tasks, runs, eventos e trilhas de auditoria.
- O projeto usa deploy por Coolify e historico operacional em docs e .ai-context.
- O contexto estavel deve vir antes do pedido dinamico e do material de debug.

Politica de mudanca:
- Antes de propor alteracoes, considere riscos de regressao.
- Mantenha compatibilidade com fluxos de webhook, campanhas, funis e mensageria.
- Evite instrucoes redundantes ou texto ornamental.
- Diga o necessario para resolver o objetivo com clareza.

Observabilidade:
- Sempre que possivel, responda com estrutura facil de auditar.
- Prefira resumo tecnico, passos concretos e justificativas curtas.
- Quando houver decisoes, explicite premissas e impacto.

Escopo funcional:
- O projeto integra mensageria oficial e nao oficial.
- O sistema possui componentes de automacao, analytics, handoff e roteamento.
- O fluxo LLM precisa registrar custo, latencia, resultado e qualidade.
- O objetivo aqui e maximizar reuso de prefixo, reduzir custo de entrada e manter rastreabilidade.

Regras de seguranca:
- Nunca ecoe segredos ou chaves.
- Nunca assuma acesso a recursos nao descritos na tarefa.
- Trate payloads dinamicos como volateis e deixe-os fora do prefixo estavel.

Formato de saida desejado:
- Responda com conteudo tecnico direto.
- Se houver plano, mantenha-o curto.
- Se houver proposta de execucao, priorize ordem pratica e impacto.

Este prefixo e estavel e deve ser reutilizado entre chamadas semelhantes.
`.trim();

export async function executeOpenAIText(input: OpenAIExecInput): Promise<OpenAIExecResult> {
  const apiKey = env("OPENAI_API_KEY");
  const model = input.model?.trim() || optionalEnv("OPENAI_EXEC_MODEL") || DEFAULT_MODEL;
  const ttl = optionalEnv("OPENAI_PROMPT_CACHE_TTL") || DEFAULT_CACHE_TTL;
  const revision = input.cacheRevision?.trim() || optionalEnv("OPENAI_PROMPT_CACHE_REVISION") || "v1";
  const promptCacheKey = buildPromptCacheKey({
    project: "evohub",
    surface: "llm-orchestrate",
    revision,
    tenant: input.tenant,
    area: input.area,
  });

  const stablePrefix = joinSections(
    DEFAULT_PROJECT_PREFIX,
    input.contextPrefix,
  );

  const messages = [
    {
      role: "system",
      content: [buildSystemTextBlock(model, stablePrefix)],
    },
    ...(input.instructions?.trim()
      ? [{
          role: "system",
          content: input.instructions.trim(),
        }]
      : []),
    {
      role: "user",
      content: input.input,
    },
  ];

  const body: Json = {
    model,
    messages,
    ...buildPromptCacheRequest(model, promptCacheKey, ttl),
  };

  if (typeof input.maxCompletionTokens === "number" && input.maxCompletionTokens > 0) {
    body.max_completion_tokens = Math.floor(input.maxCompletionTokens);
  }
  if (typeof input.temperature === "number") {
    body.temperature = input.temperature;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({} as Json));
  if (!res.ok) {
    const errorMessage = extractErrorMessage(json) || `openai ${res.status}`;
    throw new Error(errorMessage);
  }

  return {
    model,
    text: extractChatText(json),
    response: json,
    promptCacheKey,
    promptCacheTtl: supportsExplicitPromptCaching(model) ? ttl : null,
    promptCacheMode: supportsExplicitPromptCaching(model) ? "explicit" : null,
    usage: extractPromptCacheMetrics(json),
  };
}

function buildSystemTextBlock(model: string, text: string): Json {
  if (!supportsExplicitPromptCaching(model)) return { type: "text", text };
  return cacheableTextBlock(text);
}

function extractChatText(payload: Json): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as Json | undefined;
  const message = isRecord(first?.message) ? first?.message as Json : {};
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    const out = content
      .map((item) => (isRecord(item) && typeof item.text === "string") ? item.text : "")
      .filter(Boolean)
      .join("\n");
    return out.trim();
  }
  return "";
}

function extractErrorMessage(payload: Json): string | null {
  const error = isRecord(payload.error) ? payload.error as Json : {};
  if (typeof error.message === "string" && error.message.trim()) return error.message.trim();
  return null;
}

function joinSections(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
