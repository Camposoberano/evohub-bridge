// Erro do PostgREST/Supabase é um OBJETO plano (`{message, code, details, hint}`), não uma
// instância de `Error`. Por isso o padrão comum `e instanceof Error ? e.message : String(e)`
// — e `String(e)`/`${e}` — viram "[object Object]" e escondem a causa (mordeu 2x em 20/08 e a
// limpeza de events gravava erro cego). `describeError` extrai a causa real desses objetos.
type Json = Record<string, unknown>;

export function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Json;
    const parts = ["message", "code", "details", "hint"]
      .map((k) => (o[k] != null && o[k] !== "" ? `${k}=${String(o[k])}` : null))
      .filter((p): p is string => p !== null);
    if (parts.length) return parts.join(" ");
    try {
      return JSON.stringify(e);
    } catch {
      return String(e);
    }
  }
  return String(e);
}
