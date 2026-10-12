// Cliente uazapi (WhatsApp não-oficial). Admin token gere instâncias; cada instância
// tem seu token pra enviar. Tokens ficam server-side; o dashboard nunca os vê.
import { env, optionalEnv } from "./env.ts";

const BASE = () => (optionalEnv("UAZAPI_URL") ?? "").replace(/\/+$/, "");
const ADMIN = () => optionalEnv("UAZAPI_ADMIN_TOKEN") ?? "";
// Sem limite, uma conexão que não responde pode deixar o worker da fila preso em
// `processing` e impedir todos os ticks seguintes. O limite cobre cabeçalho e corpo.
const REQUEST_TIMEOUT_MS = 45_000;

type Json = Record<string, unknown>;

export class UazapiResponseError extends Error {
  constructor(
    readonly stage: "await_response" | "read_body" | "invalid_body",
    readonly elapsedMs: number,
    cause: unknown,
  ) {
    super(`uazapi ${stage} após ${elapsedMs}ms`, { cause });
    this.name = "UazapiResponseError";
  }
}

export function uazapiConfigured(): boolean {
  return Boolean(BASE() && ADMIN());
}

async function call(path: string, opts: { method?: string; headers: Record<string, string>; body?: unknown; timeoutMs?: number }) {
  const controller = new AbortController();
  const startedAt = Date.now();
  let stage: "await_response" | "read_body" = "await_response";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE()}${path}`, {
      method: opts.method ?? "GET",
      headers: { "Content-Type": "application/json", ...opts.headers },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
    stage = "read_body";
    let data: Json = {};
    try {
      data = await res.json();
    } catch (e) {
      if (timedOut) throw new UazapiResponseError("read_body", Date.now() - startedAt, e);
      if (res.ok && opts.method === "POST" && path.startsWith("/send/")) {
        throw new UazapiResponseError("invalid_body", Date.now() - startedAt, e);
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    if (e instanceof UazapiResponseError) throw e;
    if (timedOut) throw new UazapiResponseError(stage, Date.now() - startedAt, e);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const adminGet = (path: string) => call(path, { headers: { admintoken: ADMIN() } });
export const adminPost = (path: string, body?: unknown) => call(path, { method: "POST", headers: { admintoken: ADMIN() }, body });
export const instGet = (path: string, token: string) => call(path, { headers: { token } });
export const instPost = (path: string, token: string, body?: unknown, timeoutMs?: number) => call(path, { method: "POST", headers: { token }, body, timeoutMs });
export const instPut = (path: string, token: string, body?: unknown) => call(path, { method: "PUT", headers: { token }, body });
export const instDelete = (path: string, token: string, body?: unknown) => call(path, { method: "DELETE", headers: { token }, body });

// Lista instâncias (admin). Normaliza campos úteis.
export async function listInstances(): Promise<{ name: string; number: string | null; status: string; token: string }[]> {
  const r = await adminGet("/instance/all");
  const arr = Array.isArray(r.data) ? r.data as Json[] : [];
  return arr.map((i) => ({
    name: (i.name ?? i.instanceName ?? "") as string,
    number: (i.owner ?? i.phone ?? i.number ?? null) as string | null,
    status: (i.status ?? i.connectionStatus ?? "unknown") as string,
    token: (i.token ?? "") as string,
  }));
}

// Resolve o token de uma instância pelo nome (server-side; não expõe ao browser).
export async function tokenForInstance(name: string): Promise<string | null> {
  const list = await listInstances();
  return list.find((i) => i.name === name)?.token ?? null;
}

export { env };
