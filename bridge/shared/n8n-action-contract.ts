/** Contrato estável das macros comerciais do WhatsApp Oficial 5895. */
export const SOBERANO_ACTIONS = [
  "funil",
  "preco",
  "video",
  "plantio",
  "nutricao",
  "recuperacao-1",
  "recuperacao-2",
  "recuperacao-3",
  "recuperacao-4",
  "catalogo",
  "catalogo-sair",
  "pause",
  "resume",
  "stop",
] as const;

export type SoberanoAction = typeof SOBERANO_ACTIONS[number];

export type ActionRequest = {
  /** Identifica o evento, permanece igual em todas as tentativas de entrega. */
  request_id: string;
  source: "macro" | "ad";
  chatwoot_conversation_id: number;
  action: SoberanoAction;
  funnel_version: string;
};

export function isSoberanoAction(value: string): value is SoberanoAction {
  return (SOBERANO_ACTIONS as readonly string[]).includes(value);
}

export function actionKey(request: ActionRequest): string {
  return [
    "soberano-action",
    request.chatwoot_conversation_id,
    request.action,
    encodeURIComponent(request.request_id),
  ].join(":");
}

/** UUID estável para o PK da sequência e das peças da mesma solicitação. */
export async function actionUuid(key: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20)}`;
}
