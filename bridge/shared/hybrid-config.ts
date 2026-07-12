import { admin } from "./supabase.ts";

const BUCKET = "soberano-config";
const FILE = "hybrid-routes.json";
const CACHE_MS = 15_000;

export type HybridChannelConfig = {
  enabled: boolean;
  instance?: string;
  updatedAt: string;
  updatedBy?: string;
};

export type HybridConfig = {
  channels: Record<string, HybridChannelConfig>;
  updatedAt?: string;
};

let cache: HybridConfig | null = null;
let cacheAt = 0;

function emptyConfig(): HybridConfig {
  return { channels: {} };
}

export async function readHybridConfig(force = false): Promise<HybridConfig> {
  if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
  try {
    const { data } = await admin().storage.from(BUCKET).download(FILE);
    if (!data) return setCache(emptyConfig());
    const parsed = JSON.parse(await data.text()) as HybridConfig;
    return setCache({
      channels: parsed?.channels ?? {},
      updatedAt: parsed?.updatedAt,
    });
  } catch {
    return setCache(emptyConfig());
  }
}

export async function setHybridChannelConfig(
  channelId: string,
  value: { enabled: boolean; instance?: string; updatedBy?: string },
): Promise<HybridConfig> {
  const current = await readHybridConfig(true);
  const now = new Date().toISOString();
  current.channels[channelId] = {
    enabled: value.enabled,
    instance: value.instance?.trim() || undefined,
    updatedAt: now,
    updatedBy: value.updatedBy,
  };
  current.updatedAt = now;
  const { error } = await admin().storage.from(BUCKET).upload(
    FILE,
    new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }),
    { upsert: true, contentType: "application/json" },
  );
  if (error) throw new Error(`hybrid config: ${error.message}`);
  return setCache(current);
}

export function configuredChannel(
  config: HybridConfig,
  channelId: string,
): HybridChannelConfig | null {
  return config.channels[channelId] ?? null;
}

function setCache(value: HybridConfig): HybridConfig {
  cache = value;
  cacheAt = Date.now();
  return value;
}
