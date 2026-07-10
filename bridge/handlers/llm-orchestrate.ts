import {
  buildHandoffPackage,
  decideRoute,
  type ModelCandidate,
  type ModelRuntime,
  type RiskLevel,
  type TaskArea,
} from "../shared/llm-orchestrator.ts";
import { optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { executeOpenAIText } from "../shared/openai-exec.ts";
import { extractPromptCacheMetrics } from "../shared/prompt-cache.ts";
import { admin } from "../shared/supabase.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

const TASK_AREAS: TaskArea[] = [
  "architecture",
  "backend",
  "frontend_visual",
  "debug",
  "tests",
  "ops",
  "analysis",
];
const RISK_LEVELS: RiskLevel[] = ["low", "medium", "high"];
const RUN_ROLES = ["primary", "reviewer", "fallback", "arbiter"] as const;
const RUN_STATUSES = ["started", "succeeded", "failed", "timeout", "skipped"] as const;
const GATE_STATUSES = ["pass", "fail", "na"] as const;

type RunRole = (typeof RUN_ROLES)[number];
type RunStatus = (typeof RUN_STATUSES)[number];
type GateStatus = (typeof GATE_STATUSES)[number];

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authError = verifyAuth(req);
  if (authError) return authError;

  let body: Json;
  try {
    const parsed = await req.json();
    if (!isRecord(parsed)) return json({ error: "body deve ser um objeto json" }, 400);
    body = parsed;
  } catch {
    return json({ error: "bad json" }, 400);
  }

  try {
    const mode = asText(body.mode)?.toLowerCase() ?? "route";
    if (mode === "route") return await routeTask(body);
    if (mode === "execute") return await executeTask(body);
    if (mode === "attempt") return await persistAttempt(body);
    return json({ error: "mode invalido (route|execute|attempt)" }, 400);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("llm-orchestrate erro:", error);
    return json({ error: "internal error" }, 500);
  }
}

async function routeTask(body: Json): Promise<Response> {
  const routed = await createRoutedTask(body, true);
  return json({ mode: "route", task: routed.task, run: routed.run, decision: routed.decision }, 201);
}

async function executeTask(body: Json): Promise<Response> {
  const routed = await createRoutedTask(body, true);
  const db = admin();
  const model = await loadModelById(db, routed.decision.primaryModelId);
  if (!model) throw new HttpError(404, "modelo selecionado nao encontrado");
  if (!String(model.provider ?? "").toLowerCase().includes("openai")) {
    await persistAttemptRecord(db, {
      run_id: routed.run?.id,
      task_id: routed.task.id,
      model_id: routed.decision.primaryModelId,
      role: "primary",
      status: "failed",
      attempt_no: 1,
      error_code: "provider_not_supported",
      error_message: `execucao automatica ainda nao suportada para provider ${String(model.provider ?? "desconhecido")}`,
      next_model_id: routed.decision.fallbackModelIds[0] ?? null,
    });
    throw new HttpError(409, `execucao automatica ainda nao suportada para provider ${String(model.provider ?? "desconhecido")}`);
  }

  const input = buildExecutionInput(body);
  const payload = isRecord(body.payload) ? body.payload : {};
  const tenant = asText(body.cache_tenant ?? body.cacheTenant ?? payload.cache_tenant ?? payload.cacheTenant);
  const contextPrefix = asText(body.context_prefix ?? body.contextPrefix ?? payload.context_prefix ?? payload.contextPrefix);
  const instructions = asText(body.instructions ?? payload.instructions);
  const maxCompletionTokens = asPositiveInt(body.max_completion_tokens ?? body.maxCompletionTokens ?? payload.max_completion_tokens ?? payload.maxCompletionTokens);
  const temperature = asNumberMaybe(body.temperature ?? payload.temperature);

  try {
    const exec = await executeOpenAIText({
      area: String(body.area ?? payload.area ?? "analysis"),
      title: String(body.title ?? payload.title ?? "Task"),
      objective: String(body.objective ?? payload.objective ?? ""),
      input,
      model: asText(body.model_name ?? body.modelName ?? payload.model_name ?? payload.modelName) ?? String(model.model_name ?? ""),
      tenant,
      contextPrefix,
      instructions,
      maxCompletionTokens,
      temperature,
    });

    const persisted = await persistAttemptRecord(db, {
      run_id: routed.run?.id,
      task_id: routed.task.id,
      model_id: routed.decision.primaryModelId,
      role: "primary",
      status: "succeeded",
      attempt_no: 1,
      output_summary: exec.text.slice(0, 4000),
      output_payload: {
        text: exec.text,
        usage: exec.response.usage ?? {},
        model_name: exec.model,
      },
      prompt_tokens: exec.usage.promptTokens ?? undefined,
      completion_tokens: exec.usage.completionTokens ?? undefined,
      total_tokens: exec.usage.totalTokens ?? undefined,
      cached_tokens: exec.usage.cachedTokens,
      cache_write_tokens: exec.usage.cacheWriteTokens,
      cache_hit: exec.usage.cacheHit,
      prompt_cache_key: exec.promptCacheKey,
      prompt_cache_ttl: exec.promptCacheTtl ?? undefined,
      prompt_cache_mode: exec.promptCacheMode ?? undefined,
    });

    return json({
      mode: "execute",
      task: routed.task,
      decision: routed.decision,
      run: persisted.run,
      output_text: exec.text,
      usage: exec.response.usage ?? {},
      prompt_cache: {
        key: exec.promptCacheKey,
        ttl: exec.promptCacheTtl,
        mode: exec.promptCacheMode,
        cached_tokens: exec.usage.cachedTokens,
        cache_write_tokens: exec.usage.cacheWriteTokens,
        cache_hit: exec.usage.cacheHit,
      },
    }, 201);
  } catch (error) {
    const nextModelId = routed.decision.fallbackModelIds[0] ?? null;
    await persistAttemptRecord(db, {
      run_id: routed.run?.id,
      task_id: routed.task.id,
      model_id: routed.decision.primaryModelId,
      role: "primary",
      status: "failed",
      attempt_no: 1,
      error_code: "openai_execution_failed",
      error_message: String(error instanceof Error ? error.message : error),
      next_model_id: nextModelId,
    });
    const message = String(error instanceof Error ? error.message : error);
    const status = openAIErrorStatus(message);
    if (status) throw new HttpError(status, message);
    throw error;
  }
}

async function createRoutedTask(body: Json, createStartedRun: boolean): Promise<{ task: Json; run: Json | null; decision: ReturnType<typeof decideRoute> }> {
  const area = parseTaskArea(body.area);
  const risk = parseRisk(body.risk);
  const objective = asText(body.objective);
  if (!objective) throw new HttpError(400, "objective e obrigatorio");

  const title = asText(body.title) ?? `Task ${new Date().toISOString()}`;
  const payload = isRecord(body.payload) ? body.payload : {};
  const externalRef = asText(body.external_ref ?? body.externalRef) ?? null;
  const requiresReview = asBool(body.requires_review ?? body.requiresReview);
  const blockedModelIds = asStringArray(body.blocked_model_ids ?? body.blockedModelIds);
  const maxFallbacks = asPositiveInt(body.max_fallbacks ?? body.maxFallbacks);

  const db = admin();
  const maxFailures = asPositiveInt(optionalEnv("LLM_MAX_SAME_MODEL_FAILURES")) ?? 2;
  const candidates = await loadCandidates(db, maxFailures);
  if (candidates.length === 0) throw new HttpError(409, "Nenhum modelo ativo em llm_models");

  const decision = decideRoute({
    task: {
      id: externalRef ?? crypto.randomUUID(),
      area,
      risk,
      requiresReview,
    },
    candidates,
    blockedModelIds,
    maxFallbacks,
    maxConsecutiveFailuresBeforeRotation: maxFailures,
  });

  const now = new Date().toISOString();
  const primaryScore = decision.candidates.find((c) => c.modelId === decision.primaryModelId)?.score ?? null;

  const { data: task, error: taskError } = await db.from("llm_tasks").insert({
    external_ref: externalRef,
    area,
    risk_level: risk,
    title,
    objective,
    payload,
    status: "running",
    strict_review: requiresReview,
    selected_primary: decision.primaryModelId,
    selected_reviewer: decision.reviewerModelId,
    attempts: 1,
    started_at: now,
  }).select("id, status, attempts, selected_primary, selected_reviewer, created_at").single();
  if (taskError) throw new HttpError(500, messageFromError(taskError));

  let run: Json | null = null;
  if (createStartedRun) {
    const { data: createdRun, error: runError } = await db.from("llm_runs").insert({
      task_id: task.id,
      model_id: decision.primaryModelId,
      role: "primary",
      attempt_no: 1,
      status: "started",
      score: primaryScore,
      route_reason: decision.reasons,
      input_summary: shortSummary(title, objective),
      started_at: now,
    }).select("id, model_id, role, status, attempt_no, started_at").single();
    if (runError) throw new HttpError(500, messageFromError(runError));
    run = createdRun as Json;
  }

  return { task: task as unknown as Json, run, decision };
}

async function persistAttempt(body: Json): Promise<Response> {
  const taskId = asText(body.task_id ?? body.taskId);
  const modelId = asText(body.model_id ?? body.modelId);
  const status = parseRunStatus(body.status);
  const role = parseRunRole(body.role ?? "fallback");

  if (!taskId) throw new HttpError(400, "task_id e obrigatorio");
  if (!modelId) throw new HttpError(400, "model_id e obrigatorio");

  const db = admin();
  const result = await persistAttemptRecord(db, body);
  return json({
    mode: "attempt",
    task_id: taskId,
    task_status: result.taskStatus,
    run: result.run,
  }, 201);
}

async function persistAttemptRecord(db: Db, body: Json): Promise<{ run: Json; taskStatus: string }> {
  const taskId = asText(body.task_id ?? body.taskId);
  const modelId = asText(body.model_id ?? body.modelId);
  const status = parseRunStatus(body.status);
  const role = parseRunRole(body.role ?? "fallback");

  if (!taskId) throw new HttpError(400, "task_id e obrigatorio");
  if (!modelId) throw new HttpError(400, "model_id e obrigatorio");

  const { data: task, error: taskError } = await db.from("llm_tasks")
    .select("id, area, risk_level, objective, status, attempts, selected_reviewer, started_at")
    .eq("id", taskId)
    .maybeSingle();
  if (taskError) throw new HttpError(500, messageFromError(taskError));
  if (!task) throw new HttpError(404, "task_id nao encontrado");

  const nextModelId = asText(body.next_model_id ?? body.nextModelId);
  if (nextModelId) {
    const { data: found, error: foundError } = await db.from("llm_models").select("id").eq("id", nextModelId).maybeSingle();
    if (foundError) throw new HttpError(500, messageFromError(foundError));
    if (!found) throw new HttpError(400, "next_model_id nao existe");
  }

  const attemptNo = asPositiveInt(body.attempt_no ?? body.attemptNo) ?? (asNumber(task.attempts, 0) + 1);
  const now = new Date().toISOString();
  const finishedAt = isTerminalRun(status) ? now : null;

  const outputPayload = isRecord(body.output_payload ?? body.outputPayload)
    ? (body.output_payload ?? body.outputPayload) as Json
    : {};
  const cacheMetrics = extractPromptCacheMetrics(body.usage ?? outputPayload.usage ?? {});
  const runId = asText(body.run_id ?? body.runId);

  const runPatch: Json = {
    task_id: taskId,
    model_id: modelId,
    role,
    status,
    attempt_no: attemptNo,
    score: asNumberMaybe(body.score),
    route_reason: asStringArray(body.route_reason ?? body.routeReason),
    input_summary: asText(body.input_summary ?? body.inputSummary) ?? null,
    output_summary: asText(body.output_summary ?? body.outputSummary) ?? null,
    output_payload: outputPayload,
    prompt_tokens: asPositiveInt(body.prompt_tokens ?? body.promptTokens) ?? cacheMetrics.promptTokens ?? null,
    completion_tokens: asPositiveInt(body.completion_tokens ?? body.completionTokens) ?? cacheMetrics.completionTokens ?? null,
    total_tokens: asPositiveInt(body.total_tokens ?? body.totalTokens) ?? cacheMetrics.totalTokens ?? null,
    cached_tokens: asZeroOrPositiveInt(body.cached_tokens ?? body.cachedTokens) ?? cacheMetrics.cachedTokens,
    cache_write_tokens: asZeroOrPositiveInt(body.cache_write_tokens ?? body.cacheWriteTokens) ?? cacheMetrics.cacheWriteTokens,
    cache_hit: hasBool(body.cache_hit ?? body.cacheHit) ? asBool(body.cache_hit ?? body.cacheHit) : cacheMetrics.cacheHit,
    prompt_cache_key: asText(body.prompt_cache_key ?? body.promptCacheKey) ?? null,
    prompt_cache_ttl: asText(body.prompt_cache_ttl ?? body.promptCacheTtl) ?? null,
    prompt_cache_mode: asText(body.prompt_cache_mode ?? body.promptCacheMode) ?? null,
    latency_ms: asPositiveInt(body.latency_ms ?? body.latencyMs) ?? null,
    error_code: asText(body.error_code ?? body.errorCode) ?? null,
    error_message: asText(body.error_message ?? body.errorMessage) ?? null,
    finished_at: finishedAt,
  };

  let run: Json;
  if (runId) {
    (runPatch as Json).started_at = asText(body.started_at ?? body.startedAt) ?? now;
    const { data: updatedRun, error: runError } = await db.from("llm_runs").update(runPatch).eq("id", runId)
      .select("id, model_id, role, status, attempt_no, started_at, finished_at").single();
    if (runError) throw new HttpError(500, messageFromError(runError));
    run = updatedRun as unknown as Json;
  } else {
    (runPatch as Json).started_at = now;
    const { data: createdRun, error: runError } = await db.from("llm_runs").insert(runPatch)
      .select("id, model_id, role, status, attempt_no, started_at, finished_at").single();
    if (runError) throw new HttpError(500, messageFromError(runError));
    run = createdRun as unknown as Json;
  }

  const gates = parseGates(body.gates);
  if (gates) {
    const { error: gateError } = await db.from("llm_quality_gates").insert({
      task_id: taskId,
      run_id: run.id as string,
      lint_status: gates.lint,
      build_status: gates.build,
      tests_status: gates.tests,
      security_status: gates.security,
      details: {},
    });
    if (gateError) throw new HttpError(500, messageFromError(gateError));
  }

  const handoffInput = isRecord(body.handoff) ? body.handoff : null;
  if (handoffInput || nextModelId) {
    const handoffPayload = handoffInput ?? (buildHandoffPackage({
      task: {
        id: taskId,
        area: task.area as TaskArea,
        risk: task.risk_level as RiskLevel,
        requiresReview: Boolean(task.selected_reviewer),
      },
      objective: String(task.objective ?? ""),
      completedSteps: status === "succeeded" ? ["attempt_completed"] : [],
      pendingSteps: nextModelId ? [`retry_with:${nextModelId}`] : [],
      failures: status === "failed" || status === "timeout"
        ? [{ modelId, reason: asText(body.error_code ?? body.errorCode) ?? status, retryable: Boolean(nextModelId) }]
        : [],
      nextAction: nextModelId ? `rotate_to:${nextModelId}` : "await_next_step",
      decisions: [],
      artifacts: [],
      gates: gates ?? undefined,
    }) as unknown as Json);

    const checksum = asText(body.handoff_checksum ?? body.handoffChecksum) ?? await sha256Hex(JSON.stringify(handoffPayload));
    const { error: handoffError } = await db.from("llm_handoffs").insert({
      task_id: taskId,
      from_run_id: run.id,
      to_model_id: nextModelId ?? null,
      payload: handoffPayload,
      checksum,
    });
    if (handoffError) throw new HttpError(500, messageFromError(handoffError));
  }

  const nextTaskStatus = resolveTaskStatus(task.selected_reviewer as string | null, role, status, nextModelId);
  const attempts = Math.max(asNumber(task.attempts, 0), attemptNo);

  const patch: Json = {
    status: nextTaskStatus,
    attempts,
  };
  if (!task.started_at) patch.started_at = now;
  if (isTerminalTask(nextTaskStatus)) patch.finished_at = now;
  if (nextModelId && (status === "failed" || status === "timeout")) patch.selected_primary = nextModelId;

  const { error: patchError } = await db.from("llm_tasks").update(patch).eq("id", taskId);
  if (patchError) throw new HttpError(500, messageFromError(patchError));

  return { run, taskStatus: nextTaskStatus };
}

async function loadCandidates(db: Db, maxFailures: number): Promise<ModelCandidate[]> {
  const { data, error } = await db.from("llm_models")
    .select("id, provider, specialties, cost_score")
    .eq("is_active", true)
    .order("priority", { ascending: true });
  if (error) throw new HttpError(500, messageFromError(error));

  const models = (data ?? []) as Array<{ id: string; provider: string; specialties: unknown; cost_score: unknown }>;
  if (models.length === 0) return [];

  const modelIds = models.map((model) => model.id);
  const { data: runData, error: runError } = await db.from("llm_runs")
    .select("model_id, status, latency_ms, started_at")
    .in("model_id", modelIds)
    .order("started_at", { ascending: false })
    .limit(1000);
  if (runError) throw new HttpError(500, messageFromError(runError));

  const byModel = new Map<string, Array<{ status: string | null; latency_ms: number | null; started_at: string | null }>>();
  for (const row of (runData ?? []) as Array<{ model_id: string | null; status: string | null; latency_ms: number | null; started_at: string | null }>) {
    if (!row.model_id) continue;
    const list = byModel.get(row.model_id) ?? [];
    list.push({ status: row.status, latency_ms: row.latency_ms, started_at: row.started_at });
    byModel.set(row.model_id, list);
  }

  return models.map((model) => ({
    profile: {
      id: model.id,
      provider: model.provider,
      specialties: normalizeAreas(model.specialties),
      costScore: clamp01(asNumber(model.cost_score, 0.5)),
    },
    runtime: runtimeFromRuns(model.provider, byModel.get(model.id) ?? [], maxFailures),
  }));
}

function runtimeFromRuns(
  provider: string,
  runs: Array<{ status: string | null; latency_ms: number | null; started_at: string | null }>,
  maxFailures: number,
): ModelRuntime {
  const ordered = [...runs].sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
  const recent = ordered.slice(0, 20);
  const terminal = recent.filter((run) => isTerminalRun(run.status));
  const succeeded = terminal.filter((run) => run.status === "succeeded").length;

  const successRate = terminal.length > 0 ? succeeded / terminal.length : 1;
  const latencies = ordered
    .filter((run) => run.status === "succeeded" && typeof run.latency_ms === "number" && run.latency_ms > 0)
    .map((run) => run.latency_ms as number);

  let failureStreak = 0;
  for (const run of ordered) {
    if (run.status === "failed" || run.status === "timeout") {
      failureStreak++;
      continue;
    }
    break;
  }

  const providerReady = hasProviderKey(provider);
  const availabilityPenalty = Math.min(0.9, failureStreak * 0.3);

  return {
    available: providerReady && failureStreak < maxFailures,
    availabilityScore: providerReady ? Math.max(0.1, 1 - availabilityPenalty) : 0.05,
    recentSuccessRate: clamp01(successRate),
    latencyMsP95: percentile95(latencies, 12_000),
    consecutiveFailures: failureStreak,
  };
}

function resolveTaskStatus(selectedReviewer: string | null, role: RunRole, status: RunStatus, nextModelId?: string): string {
  if (status === "started") return "running";
  if (status === "succeeded") {
    if (role === "primary" && selectedReviewer) return "review";
    return "completed";
  }
  if (status === "failed" || status === "timeout") {
    return nextModelId ? "running" : "failed";
  }
  return "running";
}

function parseTaskArea(value: unknown): TaskArea {
  if (typeof value === "string" && TASK_AREAS.includes(value as TaskArea)) return value as TaskArea;
  throw new HttpError(400, "area invalida");
}

function parseRisk(value: unknown): RiskLevel {
  if (typeof value === "string" && RISK_LEVELS.includes(value as RiskLevel)) return value as RiskLevel;
  throw new HttpError(400, "risk invalido");
}

function parseRunRole(value: unknown): RunRole {
  if (typeof value === "string" && RUN_ROLES.includes(value as RunRole)) return value as RunRole;
  throw new HttpError(400, "role invalido");
}

function parseRunStatus(value: unknown): RunStatus {
  if (typeof value === "string" && RUN_STATUSES.includes(value as RunStatus)) return value as RunStatus;
  throw new HttpError(400, "status invalido");
}

function parseGates(value: unknown): { lint: GateStatus; build: GateStatus; tests: GateStatus; security: GateStatus } | null {
  if (!isRecord(value)) return null;
  return {
    lint: parseGateStatus(value.lint),
    build: parseGateStatus(value.build),
    tests: parseGateStatus(value.tests),
    security: parseGateStatus(value.security),
  };
}

function parseGateStatus(value: unknown): GateStatus {
  if (typeof value === "string" && GATE_STATUSES.includes(value as GateStatus)) return value as GateStatus;
  return "na";
}

function normalizeAreas(value: unknown): TaskArea[] {
  if (!Array.isArray(value)) return ["analysis"];
  const out = value
    .map((item) => (typeof item === "string" ? item : ""))
    .filter((item) => item && TASK_AREAS.includes(item as TaskArea))
    .map((item) => item as TaskArea);
  return out.length > 0 ? out : ["analysis"];
}

async function loadModelById(db: Db, modelId: string): Promise<Json | null> {
  const { data, error } = await db.from("llm_models")
    .select("id, provider, model_name, notes")
    .eq("id", modelId)
    .maybeSingle();
  if (error) throw new HttpError(500, messageFromError(error));
  return (data as Json | null) ?? null;
}

function hasProviderKey(provider: string): boolean {
  const low = provider.toLowerCase();
  if (low.includes("openai")) return Boolean(optionalEnv("OPENAI_API_KEY"));
  if (low.includes("google") || low.includes("gemini")) return Boolean(optionalEnv("GEMINI_API_KEY"));
  if (low.includes("cloud")) return Boolean(optionalEnv("CLOUD_API_KEY"));
  return true;
}

function verifyAuth(req: Request): Response | null {
  const expected = optionalEnv("LLM_ROUTER_API_TOKEN");
  if (!expected) return null;

  const provided = readBearer(req.headers.get("authorization")) ?? asText(req.headers.get("x-router-token"));
  if (!provided || !timingSafeEqual(expected, provided)) return json({ error: "unauthorized" }, 401);
  return null;
}

function openAIErrorStatus(message: string): number | null {
  const low = message.toLowerCase();
  if (low.includes("quota") || low.includes("billing") || low.includes("rate limit")) return 429;
  if (low.includes("invalid api key") || low.includes("authentication")) return 502;
  return null;
}

function readBearer(value: string | null): string | null {
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

function shortSummary(title: string, objective: string): string {
  const value = `${title} | ${objective}`;
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function buildExecutionInput(body: Json): string {
  const payload = isRecord(body.payload) ? body.payload : {};
  const direct = asText(body.input ?? payload.input);
  if (direct) return direct;

  const filteredPayload: Json = {};
  for (const [key, value] of Object.entries(payload)) {
    if ([
      "input",
      "instructions",
      "context_prefix",
      "contextPrefix",
      "cache_tenant",
      "cacheTenant",
      "max_completion_tokens",
      "maxCompletionTokens",
      "temperature",
      "model_name",
      "modelName",
    ].includes(key)) continue;
    filteredPayload[key] = value;
  }

  const chunks = [
    `Titulo: ${String(body.title ?? payload.title ?? "Task")}`,
    `Area: ${String(body.area ?? payload.area ?? "analysis")}`,
    `Risco: ${String(body.risk ?? payload.risk ?? "medium")}`,
    `Objetivo: ${String(body.objective ?? payload.objective ?? "")}`,
  ];
  if (Object.keys(filteredPayload).length > 0) {
    chunks.push(`Payload relevante:\n${JSON.stringify(filteredPayload, null, 2)}`);
  }
  chunks.push("Entregue uma resposta tecnica, objetiva e pronta para execucao.");
  return chunks.join("\n\n");
}

function percentile95(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function isTerminalRun(status: unknown): boolean {
  return status === "succeeded" || status === "failed" || status === "timeout" || status === "skipped";
}

function isTerminalTask(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const low = value.trim().toLowerCase();
    return low === "1" || low === "true" || low === "yes";
  }
  return false;
}

function hasBool(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value !== "string") return false;
  const low = value.trim().toLowerCase();
  return low === "1" || low === "0" || low === "true" || low === "false" || low === "yes" || low === "no";
}

function asPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

function asZeroOrPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

function asNumberMaybe(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromError(value: unknown): string {
  if (isRecord(value) && typeof value.message === "string") return value.message;
  return String(value);
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
