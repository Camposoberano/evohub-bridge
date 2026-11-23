#!/usr/bin/env node
// Ajusta somente o ritmo da campanha já preparada. Não envia mensagens.
import { loadEnv } from "./prepare-isca-campaign.mjs";

const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase não configurado");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const id = "mega-sorgo-5895-120d-2026-11-24";
const path = "/storage/v1/object/soberano-config/campaigns.json";
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
const pace = { capInicial: 50, capIncremento: 0, capMaximo: 50,
  horaInicio: 7, horaFim: 19 };
console.log(JSON.stringify({ id, currentPace: campaign.pace, targetPace: pace }));
if (!process.argv.includes("--apply")) process.exit(0);
if (campaign.pace?.capIncremento === 0 && campaign.pace?.capMaximo === 50) {
  throw new Error("Ritmo fixo já aplicado; nada a fazer");
}
const backup = "/storage/v1/object/soberano-config/backups/campaigns-before-fixed-50-20261123.json";
await call(backup, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-upsert": "false" },
  body: original,
});
campaign.pace = pace;
await call(path, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-upsert": "true" },
  body: JSON.stringify(state),
});
const verified = await (await call(path)).json();
const saved = verified.campaigns?.find((row) => row.id === id);
if (JSON.stringify(saved?.pace) !== JSON.stringify(pace)) {
  throw new Error("Verificação do novo ritmo falhou");
}
console.log(JSON.stringify({ applied: true, pace: saved.pace, backup }));
