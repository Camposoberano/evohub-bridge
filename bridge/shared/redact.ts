// Sem âncora: a versão anterior exigia casamento EXATO da chave, então `instance_token`,
// `wa_token` ou `refresh_token_v2` passavam limpos para dentro de events.payload. Chave de
// credencial quase nunca vem com o nome puro.
const SENSITIVE_KEYS =
  /(authorization|access[_-]?token|api[_-]?key|admintoken|channel[_-]?token|password|secret|token|bearer|credential)/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;

  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    clean[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactSecrets(child);
  }
  return clean;
}

/**
 * Telefone/identificador de contato para LOG. O projeto já trunca assim em outros pontos
 * (campaign-queue usa `contact_key.slice(-4)`); aqui o mesmo vira função, para o log de
 * diagnóstico parar de reter número completo de cliente sem necessidade.
 */
export function sufixoContato(valor: string | null | undefined): string {
  const limpo = String(valor ?? "").replace(/\D/g, "");
  if (!limpo) return "(sem número)";
  return `…${limpo.slice(-4)}`;
}
