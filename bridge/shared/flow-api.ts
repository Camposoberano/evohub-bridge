// flow-api — executa o nó "Chamada API" do fluxo: um POST/GET a um destino PRÉ-APROVADO.
// Portado do hub CECAPE.
//
// Fire-and-forget: manda os dados do contato pro n8n/CRM e segue. Não captura resposta — o
// estado do fluxo não persiste variáveis entre passos, então não há onde guardar o retorno.
//
// Segurança: o destino tem que estar na allowlist `FLOW_API_ALLOWLIST` (hosts separados por
// vírgula). SEM a env, NENHUM destino é permitido — um nó de API que aponta pra fora sem
// allowlist não vaza pra lugar nenhum, falha visível. Isso barra SSRF: o fluxo é montado no
// painel e não pode virar um proxy pra rede interna.
import { optionalEnv } from "./env.ts";
import { interpolate } from "./flow.ts";
import type { FlowApi } from "./flow.ts";

/** Hosts liberados, da env (vírgula). Vazio = nada liberado. Lowercase, sem espaço. */
export function apiAllowlist(): string[] {
  return (optionalEnv("FLOW_API_ALLOWLIST") ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** O host do destino está liberado? Casa exato ou subdomínio de um item da allowlist. */
export function destinoLiberado(url: string, allow: string[] = apiAllowlist()): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allow.some((a) => host === a || host.endsWith(`.${a}`));
}

/**
 * Resolve `{{env.NOME}}` num valor de header pelo valor da env na hora da chamada — o segredo
 * (token do CRM, chave do n8n) nunca fica escrito no JSON do fluxo. Outras chaves `{{x}}` saem
 * dos vars do contato. Env ausente → "".
 */
function resolverHeader(valor: string, vars: Record<string, string>): string {
  const comEnv = valor.replace(/\{\{\s*env\.([\w]+)\s*\}\}/gi, (_m, k: string) => optionalEnv(k) ?? "");
  return interpolate(comEnv, vars);
}

export type ResultadoApi = { ok: boolean; status: number; motivo?: string };

/**
 * Dispara a chamada. Lança só se o destino não estiver liberado (erro de montagem que o
 * operador precisa ver); erro de rede/timeout volta como `{ok:false}` sem derrubar o fluxo.
 */
export async function chamarApiExterna(
  api: FlowApi,
  vars: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoApi> {
  const url = (api.url ?? "").trim();
  if (!url) return { ok: false, status: 0, motivo: "sem url" };
  if (!destinoLiberado(url)) {
    throw new Error(`destino não liberado (FLOW_API_ALLOWLIST): ${(() => { try { return new URL(url).hostname; } catch { return url; } })()}`);
  }

  const method = api.method === "GET" ? "GET" : "POST";
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(api.headers ?? {})) headers[k] = resolverHeader(v, vars);

  let body: string | undefined;
  if (method === "POST") {
    if (api.bodyTemplate?.trim()) {
      body = interpolate(api.bodyTemplate, vars);
    } else {
      body = JSON.stringify(vars);
    }
    if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json";
    }
  }

  const timeoutMs = Math.min(Math.max(api.timeoutMs ?? 8000, 1000), 20000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method, headers, body, signal: ctrl.signal });
    // Lê e descarta o corpo pra não vazar conexão; não usamos o retorno.
    await res.text().catch(() => "");
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, status: 0, motivo: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}
