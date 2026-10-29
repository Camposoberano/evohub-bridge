/** An outgoing Chatwoot message with an external source ID already exists at the provider. */
export function isProviderEchoOutgoing(message: Record<string, unknown>): boolean {
  const sourceId = message.source_id;
  return typeof sourceId === "string" && sourceId.trim().length > 0;
}
