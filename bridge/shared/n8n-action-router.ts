import { optionalEnv } from "./env.ts";
import {
  isSoberanoAction,
  type ActionRequest,
  type SoberanoAction,
} from "./n8n-action-contract.ts";

export type ActionDispatchResult =
  | { ok: true; accepted: number; duplicate: boolean }
  | { ok: false; terminal: boolean; error: string };

export function enabledN8nActions(
  value = optionalEnv("SOBERANO_N8N_ACTIONS_ENABLED") ?? "",
): Set<SoberanoAction> {
  return new Set(
    value.split(",").map((part) => part.trim()).filter(isSoberanoAction),
  );
}

export function actionWebhookUrl(
  action: SoberanoAction,
  base = optionalEnv("SOBERANO_N8N_BASE_URL") ?? "",
): string {
  const parsed = new URL(base);
  if (parsed.protocol !== "https:") throw new Error("n8n exige HTTPS");
  return new URL(`/webhook/soberano-5895-${action}`, parsed)
    .toString();
}

export async function dispatchSoberanoAction(
  request: ActionRequest,
  send: typeof fetch = fetch,
): Promise<ActionDispatchResult> {
  const secret = optionalEnv("SOBERANO_N8N_WEBHOOK_SECRET");
  if (!secret) {
    return { ok: false, terminal: false, error: "credencial do webhook n8n ausente" };
  }
  let url: string;
  try {
    url = actionWebhookUrl(request.action);
  } catch {
    return { ok: false, terminal: false, error: "URL do n8n ausente ou inválida" };
  }
  try {
    const response = await send(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${secret}`,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok && result.ok === true &&
      (typeof result.accepted === "number" || result.duplicate === true ||
        typeof result.state === "string" || result.action === request.action)) {
      return {
        ok: true,
        accepted: Number(result.accepted ?? 0),
        duplicate: result.duplicate === true,
      };
    }
    return {
      ok: false,
      terminal: result.terminal === true,
      error: String(result.error ?? `n8n HTTP ${response.status}`),
    };
  } catch (error) {
    return {
      ok: false,
      terminal: false,
      error: error instanceof Error ? error.message : "n8n indisponível",
    };
  }
}
