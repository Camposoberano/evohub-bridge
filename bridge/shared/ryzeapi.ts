// Cliente RyzeAPI (WhatsApp não-oficial, provedor alternativo). TokenAccount gere/lista
// instâncias; cada instância tem seu TokenInstance pra operar (webhook, chatwoot, mensagens).
// Header sempre "token" (doc recomenda; aceita Bearer também, mas "token" é o padrão deles).
import { optionalEnv } from "./env.ts";

const BASE = "https://ryzeapi.cloud/api";
const ACCOUNT_TOKEN = () => optionalEnv("RYZEAPI_ACCOUNT_TOKEN") ?? "";

type Json = Record<string, unknown>;

export function ryzeapiConfigured(): boolean {
  return Boolean(ACCOUNT_TOKEN());
}

async function call(path: string, opts: { method?: string; token: string; body?: unknown }) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", token: opts.token },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export const acctGet = (path: string) => call(path, { token: ACCOUNT_TOKEN() });
export const acctPost = (path: string, body?: unknown) => call(path, { method: "POST", token: ACCOUNT_TOKEN(), body });
export const instGet = (path: string, token: string) => call(path, { token });
export const instPost = (path: string, token: string, body?: unknown) => call(path, { method: "POST", token, body });
export const instDelete = (path: string, token: string) => call(path, { method: "DELETE", token });

type Instance = {
  name: string;
  token: string;
  status: string;
  number: string | null;
  chatwoot: Json;
  webhook: Json;
};

// Lista instâncias da conta (TokenAccount). Normaliza campos úteis.
export async function listInstances(): Promise<Instance[]> {
  const r = await acctGet("/instance/list");
  const arr = (r.data as Json)?.instances as Json[] | undefined;
  if (!Array.isArray(arr)) return [];
  return arr.map((i) => ({
    name: (i.name ?? "") as string,
    token: (i.token ?? "") as string,
    status: (i.status ?? "unknown") as string,
    number: ((i.connection as Json)?.numberJid as string) ?? null,
    chatwoot: (i.chatwoot ?? {}) as Json,
    webhook: (i.webhook ?? {}) as Json,
  }));
}

export async function tokenForInstance(name: string): Promise<string | null> {
  const list = await listInstances();
  return list.find((i) => i.name === name)?.token ?? null;
}
