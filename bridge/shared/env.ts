// Leitura de variáveis de ambiente com erro explícito quando faltam.
export function env(key: string, fallback?: string): string {
  const v = Deno.env.get(key) ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing required env: ${key}`);
  return v;
}

export function optionalEnv(key: string): string | undefined {
  const v = Deno.env.get(key);
  return v && v.length > 0 ? v : undefined;
}
