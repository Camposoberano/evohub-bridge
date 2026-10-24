import { optionalEnv } from "./env.ts";
import {
  isSoberanoAction,
  SOBERANO_ACTIONS,
  type ActionRequest,
  type SoberanoAction,
} from "./n8n-action-contract.ts";

export type ActionDispatchResult =
  | { ok: true; accepted: number; duplicate: boolean }
  | { ok: false; terminal: boolean; error: string };

export function enabledN8nActions(
  value?: string,
): Set<SoberanoAction> {
  // O 5895 tem um único dono de conteúdo. Sem flag em produção que possa
  // reativar silenciosamente o roteiro antigo do bridge.
  if (value === undefined) return new Set(SOBERANO_ACTIONS);
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
    // Resposta no contrato: usa a contagem que o n8n reportou.
    if (response.ok && result.ok === true &&
      (typeof result.accepted === "number" || result.duplicate === true ||
        typeof result.state === "string" || result.action === request.action)) {
      return {
        ok: true,
        accepted: Number(result.accepted ?? 0),
        duplicate: result.duplicate === true,
      };
    }
    // Falha explícita, mesmo com 2xx: o n8n DISSE que não foi.
    const sinalizaFalha = result.ok === false ||
      typeof result.error === "string" || result.terminal === true;
    // 2xx sem sinal de falha = aceito. O webhook do n8n é fire-and-forget: responde logo
    // (muitas vezes 200 com corpo vazio, quando o workflow não tem nó "Respond to Webhook")
    // e processa async, com dedupe por `request_id` — por isso retentar não duplica envio.
    // A ENTREGA é confirmada à parte (reconcile-5895 / recibo uazapi), então exigir
    // `{ok:true,accepted:N}` aqui só travava a macro sem ganhar garantia. `accepted:0`
    // porque o n8n não reportou a contagem (a nota "N peças na fila" só sai quando reporta).
    if (response.ok && !sinalizaFalha) {
      return { ok: true, accepted: 0, duplicate: false };
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
