#!/usr/bin/env node
// Atualiza apenas a agenda da campanha 5895/120d. Não envia mensagens.
import { loadEnv } from "./prepare-isca-campaign.mjs";

const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase não configurado");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const id = "mega-sorgo-5895-120d-2026-11-24";
const path = "/storage/v1/object/soberano-config/campaigns.json";
const pace = {
  capInicial: 50, capIncremento: 0, capMaximo: 81,
  horaInicio: 7, horaFim: 19,
  dailyCaps: [50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 75, 78, 81],
  endAt: "2026-12-06T22:00:00Z",
};
if (pace.dailyCaps.reduce((sum, cap) => sum + cap, 0) !== 834 ||
  pace.dailyCaps.slice(0, -1).reduce((sum, cap) => sum + cap, 0) !== 753) {
  throw new Error("Rampa inconsistente");
}
async function call(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${route.split("?")[0]} HTTP ${response.status}`);
  return response;
}
const current = await call(path);
const original = await current.text();
const state = JSON.parse(original);
const campaign = state.campaigns?.find((row) => row.id === id);
if (!campaign) throw new Error("Campanha não encontrada");
if (campaign.paceStartAt !== "2026-11-24T10:00:00.000Z" ||
  campaign.pace?.horaInicio !== 7 || campaign.pace?.horaFim !== 19) {
  throw new Error("Data ou janela da campanha mudaram");
}
console.log(JSON.stringify({ id, currentPace: campaign.pace, targetPace: pace }));
if (!process.argv.includes("--apply")) process.exit(0);
if (JSON.stringify(campaign.pace) === JSON.stringify(pace)) {
  throw new Error("Rampa já aplicada; nada a fazer");
}
const backup = "/storage/v1/object/soberano-config/backups/campaigns-before-dec6-20261123.json";
await call(backup, {
  method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "false" },
  body: original,
});
campaign.pace = pace;
await call(path, {
  method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "true" },
  body: JSON.stringify(state),
});
const verified = await (await call(path)).json();
const saved = verified.campaigns?.find((row) => row.id === id);
if (JSON.stringify(saved?.pace) !== JSON.stringify(pace)) {
  throw new Error("Verificação da rampa falhou");
}
console.log(JSON.stringify({ applied: true, pace: saved.pace, backup }));
