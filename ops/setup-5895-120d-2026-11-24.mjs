#!/usr/bin/env node
// Prepara a campanha 5895/120d. Sem --apply, só valida. Nunca envia mensagens.
import { readFile } from "node:fs/promises";
import { loadEnv } from "./prepare-isca-campaign.mjs";

const ID = "mega-sorgo-5895-120d-2026-11-24";
const PRIOR = "black-friday-mega-sorgo-5895-2026-11-12";
const CHANNEL = "cf316d59-f6da-4683-adcc-29095a805dde";
const AUDIENCE = "E:/Projetos_Novos/evohub/ops/audience-5895-120d-2026-11-24.private.json";
const START = "2026-11-23T09:00:00.000Z"; // 06:00 Fortaleza
const apply = process.argv.includes("--apply");
const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error("Supabase não configurado");
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const audience = JSON.parse(await readFile(AUDIENCE, "utf8"));
const numbers = audience.numbers;
if (!Array.isArray(numbers) || numbers.length !== 811 ||
  new Set(numbers).size !== 811 ||
  numbers.some((number) => !/^55\d{10,11}$/.test(number)) ||
  audience.excludedCampaign !== PRIOR) {
  throw new Error("Público congelado diferente dos 811 números auditados");
}
async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { ...auth, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`${path.split("?")[0]} HTTP ${response.status}`);
  return response;
}
const configPath = "/storage/v1/object/soberano-config/campaigns.json";
const current = await request(configPath);
const currentText = await current.text();
const state = JSON.parse(currentText);
if (!Array.isArray(state.campaigns)) throw new Error("Configuração de campanhas inválida");
if (state.campaigns.some((campaign) => campaign.id === ID)) {
  throw new Error("Campanha já existe; não duplicar a preparação");
}
const prior = state.campaigns.find((campaign) => campaign.id === PRIOR);
if (!prior?.flow?.uazapiOnly) throw new Error("Campanha anterior não serve como modelo");
const queue = await request(`/rest/v1/campaign_queue?select=id&campaign_id=eq.${ID}&limit=1`, {
  headers: { "Accept-Profile": "public" },
});
if ((await queue.json()).length) throw new Error("Nova fila já contém registros");
const campaign = {
  ...prior,
  id: ID,
  name: "Mega Sorgo Santa Elisa — contatos 120 dias — 5895",
  createdAt: new Date().toISOString(),
  paceStartAt: START,
  pace: {
    capInicial: 50, capIncremento: 0, capMaximo: 125, horaInicio: 6, horaFim: 20,
    dailyCaps: [50, 80, 100, 110, 115, 120, 120, 125],
    endAt: "2026-11-30T23:00:00Z",
  },
  flow: {
    ...prior.flow,
    steps: prior.flow.steps.map((step) => ({
      ...step,
      ...(step.handoffContexto
        ? { handoffContexto: { ...step.handoffContexto, campanha: ID } }
        : {}),
    })),
  },
};
const opening = campaign.flow.steps.find((step) => step.id === campaign.flow.startId);
if (opening?.kind !== "buttons" || opening.imageUrls?.length !== 3 ||
  opening.buttons?.length !== 3 || !campaign.flow.uazapiOnly) {
  throw new Error("Oferta Black Friday incompleta; não preparar a fila");
}
console.log(JSON.stringify({ apply, campaignId: ID, channel: "5895", audience: numbers.length,
  startFortaleza: "2026-11-23 06:00", pace: campaign.pace,
  openingText: opening.text, imageCount: opening.imageUrls.length,
  buttons: opening.buttons.map((button) => button.title) }));
if (!apply) process.exit(0);

const backupPath = `/storage/v1/object/soberano-config/backups/campaigns-before-${ID}.json`;
await request(backupPath, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-upsert": "false" },
  body: currentText,
});
state.campaigns.push(campaign);
await request(configPath, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-upsert": "true" },
  body: JSON.stringify(state),
});
for (let i = 0; i < numbers.length; i += 500) {
  const batch = numbers.slice(i, i + 500).map((number) => ({
    campaign_id: ID,
    contact_key: number,
    channel_id: CHANNEL,
    status: "pending",
  }));
  await request("/rest/v1/campaign_queue?on_conflict=campaign_id,contact_key", {
    method: "POST",
    headers: {
      "Content-Profile": "public",
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });
}
const verify = await request(`/rest/v1/campaign_queue?select=id&campaign_id=eq.${ID}&status=eq.pending`, {
  headers: { "Accept-Profile": "public", Prefer: "count=exact", Range: "0-0" },
});
const range = verify.headers.get("content-range") ?? "";
const queued = Number(range.split("/")[1]);
if (queued !== 811) throw new Error(`Fila parcial: ${queued}/811`);
console.log(JSON.stringify({ configured: true, queued, backupPath, firstSendNotBefore: START }));
