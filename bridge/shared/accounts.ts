// accounts — mapeia canal -> account_id do Chatwoot (multi-conta na MESMA instância).
// Mesmo token, muda só o account_id na URL. Config: soberano-config/channel-accounts.json
// = { "<channel_id>": "1", ... }. Default = CHATWOOT_ACCOUNT_ID (conta principal).
import { admin } from "./supabase.ts";
import { env } from "./env.ts";

const BUCKET = "soberano-config";
const FILE = "channel-accounts.json";

let cache: Record<string, string> | null = null;
let cacheTs = 0;
const TTL_MS = 30_000;

async function load(): Promise<Record<string, string>> {
  try {
    const { data } = await (admin() as any).storage.from(BUCKET).download(FILE);
    if (!data) return {};
    return JSON.parse(await data.text()) as Record<string, string>;
  } catch {
    return {};
  }
}

// account_id do Chatwoot pra um canal (default = conta principal do env).
export async function accountForChannel(channelId: string): Promise<string> {
  const now = Date.now();
  if (!cache || now - cacheTs > TTL_MS) {
    cache = await load();
    cacheTs = now;
  }
  return cache[channelId] ?? env("CHATWOOT_ACCOUNT_ID");
}

// grava o account_id de um canal (usado no connect-channel).
export async function setAccountForChannel(channelId: string, accountId: string): Promise<void> {
  const map = await load();
  map[channelId] = accountId;
  const body = JSON.stringify(map, null, 2);
  await (admin() as any).storage.from(BUCKET).upload(FILE, new Blob([body], { type: "application/json" }), {
    upsert: true,
    contentType: "application/json",
  });
  cache = map;
  cacheTs = Date.now();
}
