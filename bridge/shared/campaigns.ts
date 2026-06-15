// Estado das campanhas gated (template oficial -> resposta abre janela -> sequência).
// Guardado em JSON no Supabase Storage (volume baixo: ≤500/dia). Sem SQL/DDL.
import { admin } from "./supabase.ts";

const BUCKET = "soberano-config";
const FILE = "campaigns.json";

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await (admin() as any).storage.createBucket(BUCKET, { public: false });
  if (error && !/exist/i.test(error.message ?? "")) console.warn("createBucket soberano-config:", error.message);
  bucketReady = true;
}

export type Step = { type: string; text?: string; file?: string; waitMin?: number };
export type Campaign = {
  id: string; name: string; template: string; language: string;
  steps: Step[]; delayMin: number; delayMax: number; createdAt: string;
};
export type Target = { campaignId: string; status: "awaiting" | "active" | "done"; step: number; ts: string };
export type CampaignState = { campaigns: Campaign[]; targets: Record<string, Target> };

export async function readCampaigns(): Promise<CampaignState> {
  // deno-lint-ignore no-explicit-any
  const { data } = await (admin() as any).storage.from(BUCKET).download(FILE);
  if (!data) return { campaigns: [], targets: {} };
  try { return JSON.parse(await data.text()); } catch { return { campaigns: [], targets: {} }; }
}

export async function writeCampaigns(state: CampaignState): Promise<void> {
  await ensureBucket();
  const blob = new Blob([JSON.stringify(state)], { type: "application/json" });
  // deno-lint-ignore no-explicit-any
  const { error } = await (admin() as any).storage.from(BUCKET).upload(FILE, blob, { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`writeCampaigns: ${error.message}`);
}

// normaliza número (só dígitos) p/ chave de target
export function numKey(n: string): string {
  return String(n).replace(/\D/g, "");
}
