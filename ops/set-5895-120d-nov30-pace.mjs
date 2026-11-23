#!/usr/bin/env node
// Ativa a rampa aprovada para 23–30/11. Não envia mensagens por si só.
import { loadEnv } from "./prepare-isca-campaign.mjs";

const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase não configurado");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const id = "mega-sorgo-5895-120d-2026-11-24";
const path = "/storage/v1/object/soberano-config/campaigns.json";
const start = "2026-11-23T09:00:00.000Z"; // 06h Fortaleza
const pace = {
  capInicial: 50, capIncremento: 0, capMaximo: 125,
  horaInicio: 6, horaFim: 20,
  dailyCaps: [50, 80, 100, 110, 115, 120, 120, 125],
  endAt: "2026-11-30T23:00:00Z", // 20h Fortaleza
};
if (pace.dailyCaps.reduce((a, b) => a + b, 0) !== 820 ||
  pace.dailyCaps.slice(0, -1).reduce((a, b) => a + b, 0) !== 695) {
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
  campaign.pace?.endAt !== "2026-12-06T22:00:00Z") {
  throw new Error("Agenda anterior mudou; revisar antes de aplicar");
}
console.log(JSON.stringify({ id, currentStart: campaign.paceStartAt,
  currentEnd: campaign.pace.endAt, nextStart: start, nextPace: pace }));
if (!process.argv.includes("--apply")) process.exit(0);
const backup = "/storage/v1/object/soberano-config/backups/campaigns-before-nov30-20261123.json";
await call(backup, {
  method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "false" },
  body: original,
});
campaign.paceStartAt = start;
campaign.pace = pace;
await call(path, {
  method: "POST", headers: { "Content-Type": "application/json", "x-upsert": "true" },
  body: JSON.stringify(state),
});
const verified = await (await call(path)).json();
const saved = verified.campaigns?.find((row) => row.id === id);
if (saved?.paceStartAt !== start || JSON.stringify(saved?.pace) !== JSON.stringify(pace)) {
  throw new Error("Verificação da agenda falhou");
}
console.log(JSON.stringify({ applied: true, start, pace: saved.pace, backup }));
