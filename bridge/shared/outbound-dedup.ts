type Json = Record<string, unknown>;

export function outboundClaimKey(
  conversationId: number,
  type: string,
  payload: Json,
): string {
  const content = JSON.stringify(payload);
  let hash = 0x811c9dc5;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `send-out-${conversationId}-${type}-${content.length}-${
    (hash >>> 0).toString(16)
  }`;
}
