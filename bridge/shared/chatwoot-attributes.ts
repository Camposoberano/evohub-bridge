export function chatwootAttributes(value: unknown): Record<string, unknown> {
  let parsed = value;
  for (let i = 0; i < 2 && typeof parsed === "string"; i++) {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return {};
    }
  }
  return parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

export function alreadySentByBridge(value: unknown): boolean {
  const marker = chatwootAttributes(value).bridge_already_sent;
  return marker === true || marker === "true";
}
