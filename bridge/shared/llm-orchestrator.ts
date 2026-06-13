export type TaskArea =
  | "architecture"
  | "backend"
  | "frontend_visual"
  | "debug"
  | "tests"
  | "ops"
  | "analysis";

export type RiskLevel = "low" | "medium" | "high";

export type GateStatus = "pass" | "fail" | "na";

export interface QualityGates {
  lint: GateStatus;
  build: GateStatus;
  tests: GateStatus;
  security: GateStatus;
}

export interface OrchestrationTask {
  id: string;
  area: TaskArea;
  risk: RiskLevel;
  requiresReview?: boolean;
}

export interface ModelProfile {
  id: string;
  provider: string;
  specialties: TaskArea[];
  costScore: number;
}

export interface ModelRuntime {
  available: boolean;
  availabilityScore: number;
  recentSuccessRate: number;
  latencyMsP95: number;
  consecutiveFailures: number;
}

export interface ModelCandidate {
  profile: ModelProfile;
  runtime: ModelRuntime;
}

export interface RoutingWeights {
  specialty: number;
  availability: number;
  history: number;
  latency: number;
  cost: number;
}

export interface RoutingInput {
  task: OrchestrationTask;
  candidates: ModelCandidate[];
  blockedModelIds?: string[];
  maxFallbacks?: number;
  maxConsecutiveFailuresBeforeRotation?: number;
  weights?: Partial<RoutingWeights>;
}

export interface CandidateScore {
  modelId: string;
  provider: string;
  score: number;
  specialtyScore: number;
  availabilityScore: number;
  historyScore: number;
  latencyScore: number;
  costScore: number;
  available: boolean;
  consecutiveFailures: number;
}

export interface RouteDecision {
  primaryModelId: string;
  reviewerModelId: string | null;
  fallbackModelIds: string[];
  requiresReview: boolean;
  candidates: CandidateScore[];
  reasons: string[];
}

export interface HandoffDecision {
  decision: string;
  rationale: string;
  evidence?: string[];
}

export interface HandoffFailure {
  modelId: string;
  reason: string;
  retryable: boolean;
}

export interface HandoffArtifact {
  path: string;
  changeType: "created" | "updated" | "deleted";
}

export interface HandoffPackage {
  version: "1.0";
  createdAt: string;
  taskId: string;
  objective: string;
  completedSteps: string[];
  pendingSteps: string[];
  decisions: HandoffDecision[];
  failures: HandoffFailure[];
  nextAction: string;
  artifacts: HandoffArtifact[];
  gates: QualityGates;
}

export interface BuildHandoffInput {
  task: OrchestrationTask;
  objective: string;
  completedSteps?: string[];
  pendingSteps?: string[];
  decisions?: HandoffDecision[];
  failures?: HandoffFailure[];
  nextAction: string;
  artifacts?: HandoffArtifact[];
  gates?: Partial<QualityGates>;
}

const DEFAULT_WEIGHTS: RoutingWeights = {
  specialty: 0.4,
  availability: 0.25,
  history: 0.15,
  latency: 0.1,
  cost: 0.1,
};

const DEFAULT_MAX_FALLBACKS = 2;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 2;
const LATENCY_P95_BEST_MS = 1_000;
const LATENCY_P95_WORST_MS = 25_000;

export function decideRoute(input: RoutingInput): RouteDecision {
  const weights = mergeWeights(input.weights);
  const blocked = new Set(input.blockedModelIds ?? []);
  const maxFallbacks = input.maxFallbacks ?? DEFAULT_MAX_FALLBACKS;
  const maxConsecutiveFailures =
    input.maxConsecutiveFailuresBeforeRotation ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;

  const candidates = input.candidates
    .filter((candidate) => !blocked.has(candidate.profile.id))
    .map((candidate) => scoreCandidate(input.task, candidate, weights))
    .sort(compareScores);

  if (candidates.length === 0) {
    throw new Error("No eligible LLM candidate after blocked model filter.");
  }

  const preferredPool = candidates.filter(
    (candidate) =>
      candidate.available && candidate.consecutiveFailures < maxConsecutiveFailures,
  );
  const pool = preferredPool.length > 0 ? preferredPool : candidates;
  const primary = pool[0];

  const requiresReview = input.task.requiresReview ?? input.task.risk === "high";
  const reviewer = requiresReview
    ? findReviewer(pool, primary.modelId, primary.provider)
    : null;

  const usedIds = new Set<string>([primary.modelId]);
  if (reviewer) usedIds.add(reviewer.modelId);

  const fallbackModelIds = candidates
    .filter((candidate) => !usedIds.has(candidate.modelId))
    .slice(0, maxFallbacks)
    .map((candidate) => candidate.modelId);

  const reasons = buildReasons({
    task: input.task,
    blockedModelCount: blocked.size,
    usedPreferredPool: preferredPool.length > 0,
    reviewerFound: Boolean(reviewer),
  });

  return {
    primaryModelId: primary.modelId,
    reviewerModelId: reviewer?.modelId ?? null,
    fallbackModelIds,
    requiresReview,
    candidates,
    reasons,
  };
}

export function shouldRotateModel(
  consecutiveFailures: number,
  maxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAILURES,
): boolean {
  return consecutiveFailures >= maxConsecutiveFailures;
}

export function buildHandoffPackage(input: BuildHandoffInput): HandoffPackage {
  const defaultGates: QualityGates = {
    lint: "na",
    build: "na",
    tests: "na",
    security: "na",
  };

  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    taskId: input.task.id,
    objective: input.objective,
    completedSteps: input.completedSteps ?? [],
    pendingSteps: input.pendingSteps ?? [],
    decisions: input.decisions ?? [],
    failures: input.failures ?? [],
    nextAction: input.nextAction,
    artifacts: input.artifacts ?? [],
    gates: {
      ...defaultGates,
      ...(input.gates ?? {}),
    },
  };
}

function scoreCandidate(
  task: OrchestrationTask,
  candidate: ModelCandidate,
  weights: RoutingWeights,
): CandidateScore {
  const specialtyScore = computeSpecialtyScore(task.area, candidate.profile.specialties);
  const availabilityScore = clamp01(candidate.runtime.availabilityScore);
  const historyScore = clamp01(candidate.runtime.recentSuccessRate);
  const latencyScore = computeLatencyScore(candidate.runtime.latencyMsP95);
  const costScore = clamp01(candidate.profile.costScore);

  const score =
    specialtyScore * weights.specialty +
    availabilityScore * weights.availability +
    historyScore * weights.history +
    latencyScore * weights.latency +
    costScore * weights.cost;

  return {
    modelId: candidate.profile.id,
    provider: candidate.profile.provider,
    score: round3(score),
    specialtyScore: round3(specialtyScore),
    availabilityScore: round3(availabilityScore),
    historyScore: round3(historyScore),
    latencyScore: round3(latencyScore),
    costScore: round3(costScore),
    available: candidate.runtime.available,
    consecutiveFailures: candidate.runtime.consecutiveFailures,
  };
}

function computeSpecialtyScore(area: TaskArea, specialties: TaskArea[]): number {
  if (specialties.includes(area)) return 1;
  if (area === "analysis" && specialties.includes("architecture")) return 0.75;
  if (area === "debug" && specialties.includes("backend")) return 0.7;
  if (area === "tests" && specialties.includes("backend")) return 0.65;
  return 0.3;
}

function computeLatencyScore(latencyMsP95: number): number {
  if (!Number.isFinite(latencyMsP95) || latencyMsP95 <= 0) return 0;
  if (latencyMsP95 <= LATENCY_P95_BEST_MS) return 1;
  if (latencyMsP95 >= LATENCY_P95_WORST_MS) return 0;
  const range = LATENCY_P95_WORST_MS - LATENCY_P95_BEST_MS;
  return 1 - (latencyMsP95 - LATENCY_P95_BEST_MS) / range;
}

function findReviewer(
  candidates: CandidateScore[],
  primaryModelId: string,
  primaryProvider: string,
): CandidateScore | null {
  const crossProvider = candidates.find(
    (candidate) =>
      candidate.modelId !== primaryModelId &&
      candidate.provider !== primaryProvider &&
      candidate.available,
  );
  if (crossProvider) return crossProvider;

  return (
    candidates.find(
      (candidate) => candidate.modelId !== primaryModelId && candidate.available,
    ) ?? null
  );
}

function compareScores(a: CandidateScore, b: CandidateScore): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.available !== b.available) return a.available ? -1 : 1;
  return a.modelId.localeCompare(b.modelId);
}

function mergeWeights(weights?: Partial<RoutingWeights>): RoutingWeights {
  const merged = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) };
  const sum = merged.specialty + merged.availability + merged.history + merged.latency + merged.cost;

  if (sum <= 0) return { ...DEFAULT_WEIGHTS };

  return {
    specialty: merged.specialty / sum,
    availability: merged.availability / sum,
    history: merged.history / sum,
    latency: merged.latency / sum,
    cost: merged.cost / sum,
  };
}

function buildReasons(input: {
  task: OrchestrationTask;
  blockedModelCount: number;
  usedPreferredPool: boolean;
  reviewerFound: boolean;
}): string[] {
  const reasons: string[] = [];
  reasons.push(`task-area:${input.task.area}`);
  reasons.push(`task-risk:${input.task.risk}`);

  if (input.blockedModelCount > 0) {
    reasons.push(`blocked-models:${input.blockedModelCount}`);
  }
  reasons.push(input.usedPreferredPool ? "pool:healthy-models" : "pool:all-models-fallback");

  if (input.task.requiresReview || input.task.risk === "high") {
    reasons.push(input.reviewerFound ? "reviewer:selected" : "reviewer:missing");
  }
  return reasons;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
