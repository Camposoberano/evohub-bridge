type Json = Record<string, unknown>;

export interface PromptCacheKeyParts {
  project: string;
  surface: string;
  revision: string;
  tenant?: string;
  area?: string;
}

export interface PromptCacheMetrics {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number;
  cacheWriteTokens: number;
  cacheHit: boolean;
}

const DEFAULT_TTL = "30m";

export function buildPromptCacheKey(parts: PromptCacheKeyParts): string {
  const items = [
    sanitizePart(parts.project),
    sanitizePart(parts.surface),
    sanitizePart(parts.revision),
    sanitizePart(parts.tenant ?? "global"),
    sanitizePart(parts.area ?? "general"),
  ];
  return items.join(":").slice(0, 180);
}

export function supportsExplicitPromptCaching(model: string): boolean {
  const low = String(model ?? "").toLowerCase();
  return low.startsWith("gpt-5.6");
}

export function buildPromptCacheRequest(
  model: string,
  key: string,
  ttl = DEFAULT_TTL,
): Json {
  if (!supportsExplicitPromptCaching(model)) return {};
  return {
    prompt_cache_key: key,
    prompt_cache_options: {
      mode: "explicit",
      ttl,
    },
  };
}

export function cacheableTextBlock(text: string): Json {
  return {
    type: "text",
    text,
    prompt_cache_breakpoint: {
      mode: "explicit",
    },
  };
}

export function extractPromptCacheMetrics(payload: unknown): PromptCacheMetrics {
  const body = isRecord(payload) ? payload : {};
  const usage = isRecord(body.usage) ? body.usage : body;
  const promptDetails = firstRecord(
    usage.prompt_tokens_details,
    usage.input_tokens_details,
  );

  const cachedTokens = positiveInt(promptDetails.cached_tokens) ?? 0;
  const cacheWriteTokens = positiveInt(promptDetails.cache_write_tokens) ?? 0;

  return {
    promptTokens: positiveInt(usage.prompt_tokens ?? usage.input_tokens) ?? null,
    completionTokens: positiveInt(usage.completion_tokens ?? usage.output_tokens) ?? null,
    totalTokens: positiveInt(usage.total_tokens) ?? null,
    cachedTokens,
    cacheWriteTokens,
    cacheHit: cachedTokens > 0,
  };
}

function sanitizePart(value: string): string {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "na";
}

function positiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstRecord(...values: unknown[]): Json {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return {};
}
