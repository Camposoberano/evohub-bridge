// webhook-url — leitura de URL de webhook, sem dependência de banco ou de rede.
//
// Separado do handler de propósito: o relatório de prontidão decide, a partir dessas duas
// funções, se um número novo está ligado ao bridge — e essa decisão precisa de teste, não
// de um cliente Supabase carregado junto.

/**
 * A URL aponta para o NOSSO bridge, no receptor indicado?
 *
 * Compara host + caminho, nunca a string inteira. Um webhook gravado com o segredo antigo
 * continua sendo nosso, só que desatualizado — e comparar a URL completa o classificaria
 * como "de terceiro", fazendo o provisionamento criar um webhook duplicado em vez de
 * substituir o velho.
 */
export function ehNossoWebhook(
  url: unknown,
  caminho: string,
  base: string,
): boolean {
  const s = String(url ?? "");
  if (!s) return false;
  try {
    const u = new URL(s);
    const nosso = new URL(base);
    return u.host === nosso.host && u.pathname === caminho;
  } catch {
    return false;
  }
}

/** Token da query string, que é como uazapi e Chatwoot se autenticam no bridge. */
export function tokenDoWebhook(url: unknown): string | null {
  try {
    return new URL(String(url ?? "")).searchParams.get("token");
  } catch {
    return null;
  }
}
