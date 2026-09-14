// erros — transformar o que foi lançado em texto que serve para diagnóstico.
//
// O erro do Supabase é um objeto `{ message, code, details, hint }`, não um `Error`:
// `String(e)` devolve "[object Object]" e o log fica dizendo que algo falhou sem dizer o quê.
// Já custou duas investigações em 20/08 e reapareceu em 13 e 14/09 em módulo novo — por isso
// virou função compartilhada em vez de ficar copiada.

export function descreveErro(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const partes = [o.message, o.code, o.details, o.hint]
      .filter((v) => v != null && v !== "")
      .map(String);
    if (partes.length) return partes.join(" · ");
    try {
      return JSON.stringify(e);
    } catch {
      return "[erro não serializável]";
    }
  }
  return String(e);
}
