// accounts — resolve a CONTA Chatwoot de cada canal (multi-cliente: outra URL/token/account).
// Mapas em soberano-config:
//   channel-accounts.json   = { "<channel_id>": "<accountKey>" }
//   chatwoot-accounts.json  = { accounts: [{ id, label, accountId, url, token, ativa }] }
// Default = conta principal do env.
import { admin } from "./supabase.ts";
import { type CwAcct, envAcct } from "./chatwoot.ts";

const BUCKET = "soberano-config";
const CH_FILE = "channel-accounts.json";
const ACC_FILE = "chatwoot-accounts.json";

type StoredAcct = { id: string; label: string; accountId: string; url: string; token?: string; ativa?: boolean };

let chCache: Record<string, string> | null = null;
let accCache: StoredAcct[] | null = null;
let ts = 0;
const TTL_MS = 30_000;

async function dl<T>(file: string, fallback: T): Promise<T> {
  try {
    const { data } = await (admin() as any).storage.from(BUCKET).download(file);
    if (data) return JSON.parse(await data.text());
  } catch { /* vazio */ }
  return fallback;
}

async function refresh() {
  const now = Date.now();
  if (chCache && accCache && now - ts <= TTL_MS) return;
  chCache = await dl<Record<string, string>>(CH_FILE, {});
  const accObj = await dl<{ accounts?: StoredAcct[] }>(ACC_FILE, {});
  accCache = Array.isArray(accObj.accounts) ? accObj.accounts : [];
  ts = now;
}

// CwAcct (url+token+accountId) de uma conta da lista; default = env.
function toCwAcct(a: StoredAcct | undefined): CwAcct {
  const def = envAcct();
  if (!a) return def;
  return {
    url: a.url || def.url,
    token: a.token || def.token, // conta sem token guardado (mesma instância) -> usa o do env
    accountId: a.accountId,
    adminToken: def.adminToken,
  };
}

// Conta Chatwoot completa pra um canal (pra o bridge postar entrada na conta certa).
export async function accountForChannel(channelId: string): Promise<CwAcct> {
  await refresh();
  const key = chCache![channelId];
  if (!key) return envAcct();
  const found = accCache!.find((a) => a.id === key || a.accountId === key);
  return toCwAcct(found);
}

// mapa canal -> accountKey (pro painel mostrar/atribuir).
export async function getChannelMap(): Promise<Record<string, string>> {
  return await dl<Record<string, string>>(CH_FILE, {});
}

// grava (ou remove, se accountKey vazio) o canal -> conta.
export async function setAccountForChannel(channelId: string, accountKey: string): Promise<void> {
  const map = await dl<Record<string, string>>(CH_FILE, {});
  if (accountKey) map[channelId] = accountKey;
  else delete map[channelId];
  await (admin() as any).storage.from(BUCKET).upload(CH_FILE, new Blob([JSON.stringify(map, null, 2)], { type: "application/json" }), {
    upsert: true, contentType: "application/json",
  });
  chCache = map;
  ts = Date.now();
}

// CwAcct por id/accountId (usado no connect-channel pra criar inbox na instância certa).
export async function acctByKey(accountKey: string): Promise<CwAcct> {
  await refresh();
  const found = accCache!.find((a) => a.id === accountKey || a.accountId === accountKey);
  return toCwAcct(found);
}
