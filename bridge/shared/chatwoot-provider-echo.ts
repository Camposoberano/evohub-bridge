/** An outgoing Chatwoot message with an external source ID already exists at the provider. */
export function isProviderEchoOutgoing(message: Record<string, unknown>): boolean {
  const sourceId = message.source_id;
  return typeof sourceId === "string" && sourceId.trim().length > 0;
}

// Quando DELETA, EDITA ou REAGE a uma mensagem no WhatsApp, a uazapi espelha o evento no
// Chatwoot como mensagem de SAÍDA de texto ("🗑️ [ Mensagem deletada ]", "👍🏻 [ reação ]"),
// SEM `source_id` — logo escapa de isProviderEchoOutgoing. Reenviar esse aviso ao cliente é
// sempre errado e, como cada volta vira uma nova mensagem (id novo), o claim cw-out-<id> nunca
// deduplica e o envio entra em loop (103x "Mensagem deletada" medido em 29/10). Nunca reenviar.
const UAZAPI_NOTICE_RE =
  /\[\s*(mensagem\s+(deletada|editada|apagada)|rea[cç][aã]o)\s*\]/iu;

export function isUazapiSystemNotice(content: unknown): boolean {
  return typeof content === "string" && UAZAPI_NOTICE_RE.test(content);
}
