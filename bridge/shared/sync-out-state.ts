// Estado técnico do fallback de saída do Chatwoot. Não contém dados de conversa;
// serve apenas para calcular a janela de recuperação depois de reinício do bridge.
import { admin } from "./supabase.ts";

const BUCKET = "soberano-config";
const FILE = "sync-chatwoot-out-state.json";

type SyncOutState = {
  lastSuccessfulAt?: string;
};

export async function readSyncOutState(): Promise<SyncOutState> {
  try {
    const { data } = await (admin() as any).storage.from(BUCKET).download(FILE);
    if (!data) return {};
    const parsed = JSON.parse(await data.text()) as SyncOutState;
    return typeof parsed?.lastSuccessfulAt === "string"
      ? { lastSuccessfulAt: parsed.lastSuccessfulAt }
      : {};
  } catch {
    return {};
  }
}

export async function writeSyncOutState(
  lastSuccessfulAt: string,
): Promise<void> {
  const { error } = await (admin() as any).storage.from(BUCKET).upload(
    FILE,
    new Blob([JSON.stringify({ lastSuccessfulAt })], {
      type: "application/json",
    }),
    { upsert: true, contentType: "application/json" },
  );
  if (error) throw new Error(`sync-out state: ${error.message}`);
}

export function syncOutSinceMinutes(
  lastSuccessfulAt: string | null,
  steadyMinutes: number,
  recoveryMinutes: number,
  now = Date.now(),
): number {
  if (!lastSuccessfulAt) return recoveryMinutes;
  const previous = Date.parse(lastSuccessfulAt);
  if (!Number.isFinite(previous)) return recoveryMinutes;
  const elapsedMinutes = Math.ceil(Math.max(0, now - previous) / 60_000);
  return Math.min(
    recoveryMinutes,
    Math.max(steadyMinutes, elapsedMinutes + 1),
  );
}
