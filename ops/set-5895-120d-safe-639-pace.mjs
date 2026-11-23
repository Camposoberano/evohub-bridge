#!/usr/bin/env node
// Recalibra a rampa após excluir etiquetas cruzadas e status lost. Não envia mensagens.
import { loadEnv } from "./prepare-isca-campaign.mjs";

const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase não configurado");
const headers = { apikey: key, Authorization: `Bearer ${key}` };
const id = "mega-sorgo-5895-120d-2026-11-24";
const path = "/storage/v1/object/soberano-config/campaigns.json";
const pace = {
  capInicial: 50, capIncremento: 0, capMaximo: 112,
  horaInicio: 6, horaFim: 20,
  dailyCaps: [50, 60, 70, 78, 85, 92, 100, 112],
  endAt: "2026-11-30T23:00:00Z",
};
if (pace.dailyCaps.reduce((a, b) => a + b, 0) !== 647 ||
  pace.dailyCaps.slice(0, -1).reduce((a, b) => a + b, 0) !== 535) {
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
if (!campaign || campaign.paceStartAt !== "2026-11-23T09:00:00.000Z" ||
  campaign.pace?.capMaximo !== 125 ||
  campaign.pace?.endAt !== "2026-11-30T23:00:00Z") {
  throw new Error("Campanha mudou; revisar antes de aplicar");
}
const queueResponse = await call(`/rest/v1/campaign_queue?select=id&campaign_id=eq.${id}&status=eq.pending`, {
  headers: { "Accept-Profile": "public", Prefer: "count=exact", Range: "0-0" },
});
const queued = Number((queueResponse.headers.get("content-range") ?? "").split("/")[1]);
if (queued !== 639) throw new Error(`Fila pendente mudou: ${queued}`);
console.log(JSON.stringify({ id, queued, currentPace: campaign.pace, targetPace: pace }));
if (!process.argv.includes("--apply")) process.exit(0);
const backup = "/storage/v1/object/soberano-config/backups/campaigns-before-safe-639-20261123.json";
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
console.log(JSON.stringify({ applied: true, queued, pace: saved.pace, backup }));
