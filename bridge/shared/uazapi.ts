// Cliente uazapi (WhatsApp não-oficial). Admin token gere instâncias; cada instância
// tem seu token pra enviar. Tokens ficam server-side; o dashboard nunca os vê.
import { env, optionalEnv } from "./env.ts";

const BASE = () => (optionalEnv("UAZAPI_URL") ?? "").replace(/\/+$/, "");
const ADMIN = () => optionalEnv("UAZAPI_ADMIN_TOKEN") ?? "";

type Json = Record<string, unknown>;

export function uazapiConfigured(): boolean {
  return Boolean(BASE() && ADMIN());
}

async function call(path: string, opts: { method?: string; headers: Record<string, string>; body?: unknown }) {
  const res = await fetch(`${BASE()}${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const adminGet = (path: string) => call(path, { headers: { admintoken: ADMIN() } });
export const adminPost = (path: string, body?: unknown) => call(path, { method: "POST", headers: { admintoken: ADMIN() }, body });
export const instGet = (path: string, token: string) => call(path, { headers: { token } });
export const instPost = (path: string, token: string, body?: unknown) => call(path, { method: "POST", headers: { token }, body });

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
