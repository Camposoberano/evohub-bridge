// native — quais canais oficiais usam CAIXA NATIVA do Chatwoot (direto Meta).
// Pra esses, o bridge NÃO posta no Chatwoot (evita duplicata) — só persiste no banco
// (analytics) e roda o motor de campanha. A entrada chega na nativa via repasse do EVO Hub.
// Config: soberano-config/native-inboxes.json = { phoneNumberIds: ["101473206115219", ...] }
import { admin } from "./supabase.ts";

const BUCKET = "soberano-config";
const FILE = "native-inboxes.json";

let cache: Set<string> | null = null;
let cacheTs = 0;
const TTL_MS = 60_000;

export async function isNativeChannel(phoneNumberId: string | null | undefined): Promise<boolean> {
  if (!phoneNumberId) return false;
  const now = Date.now();
  if (!cache || now - cacheTs > TTL_MS) {
    cache = await load();
    cacheTs = now;
  }
  return cache.has(phoneNumberId);
}

async function load(): Promise<Set<string>> {
  try {
    const { data } = await (admin() as any).storage.from(BUCKET).download(FILE);
    if (!data) return new Set();
    const json = JSON.parse(await data.text());
    return new Set((json.phoneNumberIds ?? []) as string[]);
  } catch {
    return new Set();
  }
}
