const SENSITIVE_KEYS =
  /^(authorization|access[_-]?token|api[_-]?key|admintoken|channel[_-]?token|password|secret|token)$/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;

  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    clean[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactSecrets(child);
  }
  return clean;
}
