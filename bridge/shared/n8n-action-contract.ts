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
