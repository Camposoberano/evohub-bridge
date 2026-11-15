// Portado do hub CECAPE. Extrai o id da mensagem enviada do response do provedor (uazapi/meta),
// pra correlacionar recibos de status (message_events) com a mensagem que saiu.
type Json = Record<string, unknown>;
const object = (v: unknown): Json | null => v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;

/** Só um ID retornado pela resposta aceita do provedor pode vincular uma mensagem enviada. */
export function extractProviderSendId(response: unknown): string | null {
  const body = object(response);
  if (!body) return null;
  const data = object(body.data);
  const first = Array.isArray(body.messages) ? object(body.messages[0]) : null;
  // Recibos carregam WhatsApp MessageIDs, não o id composto interno da Uazapi.
  for (const value of [first?.messageid, data?.messageid, body.messageid,
    first?.messageId, data?.messageId, body.messageId,
    first?.message_id, data?.message_id, body.message_id,
    first?.id, data?.id, body.id]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
