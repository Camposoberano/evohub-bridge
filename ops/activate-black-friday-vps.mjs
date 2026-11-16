#!/usr/bin/env node
// Migra a campanha Black Friday do estado local para a fila durável do bridge no VPS.
// Padrão é leitura/preflight. Use --apply para gravar a configuração e a fila.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CAMPAIGN_ID = "black-friday-mega-sorgo-5895-2026-11-12";
const STATE_FILE = CAMPAIGN_ID + ".json";
const CHANNEL_ID = "cf316d59-f6da-4683-adcc-29095a805dde";
const TARGETS = 641;
const BUCKET = "soberano-config";
const HOME = process.env.EVOHUB_HOME || "E:\\Projetos_Novos\\evohub";
const apply = process.argv.includes("--apply");
const parsedEnv = {};
for (const line of readFileSync(resolve(HOME, ".env"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  let value = match[2];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  parsedEnv[match[1]] = value;
}
const env = { ...process.env, ...parsedEnv };
const supaBase = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
const supaKey = env.SUPABASE_SERVICE_ROLE_KEY;
const schema = String(env.SUPABASE_SCHEMA || "evohub");
if (!supaBase || !supaKey) throw new Error("Supabase EvoHub incompleto");
if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error("SUPABASE_SCHEMA inválido");
const authHeaders = { apikey: supaKey, Authorization: "Bearer " + supaKey };

function fail(message) { throw new Error(message); }
async function request(url, options = {}) {
  const headers = { ...authHeaders, ...(options.headers || {}) };
  const response = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(45000) });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) fail("EvoHub HTTP " + response.status);
  return data;
}
async function readStorage(name) {
  const response = await fetch(supaBase + "/storage/v1/object/" + BUCKET + "/" + name, {
    headers: authHeaders, signal: AbortSignal.timeout(45000),
  });
  const raw = await response.text();
  if (response.status === 404) return null;
  if (!response.ok) fail("Storage HTTP " + response.status);
  return JSON.parse(raw);
}
async function writeStorage(name, value) {
  const response = await fetch(supaBase + "/storage/v1/object/" + BUCKET + "/" + name, {
    method: "POST",
    headers: { ...authHeaders, "x-upsert": "true", "Content-Type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) fail("Não foi possível gravar Storage HTTP " + response.status);
}
function queueUrl() {
  const url = new URL(supaBase + "/rest/v1/campaign_queue");
  url.searchParams.set("select", "contact_key,status,sent_at");
  url.searchParams.set("campaign_id", "eq." + CAMPAIGN_ID);
  url.searchParams.set("limit", "1000");
  return url;
}
async function readQueue() {
  return await request(queueUrl(), { headers: { "Accept-Profile": "public" } }) || [];
}
const state = await readStorage(STATE_FILE);
if (!state) fail("Estado privado da campanha não encontrado");
if (state.id !== CAMPAIGN_ID || Number(state.targetCount) !== TARGETS || !Array.isArray(state.targets) || state.targets.length !== TARGETS) {
  fail("A fila local não corresponde ao público aprovado de 641 contatos");
}
if (state.status !== "running" && state.status !== "migrating_to_vps") {
  fail("Estado local incompatível com migração: " + String(state.status));
}
if (state.provider !== "uazapi") fail("A fila local não está configurada para UAZAPI");
if (!state.message || !state.startDayBrt) fail("Mensagem ou data inicial ausente");
const counts = {};
const seen = new Set();
for (const target of state.targets) {
  const phone = String(target.phone || "").replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(phone) || seen.has(phone)) fail("Público com telefone inválido ou duplicado");
  seen.add(phone);
  counts[target.status] = (counts[target.status] || 0) + 1;
}
if (counts.sent !== 2 || counts.pending !== TARGETS - 2 || Object.keys(counts).some(k => !["sent", "pending"].includes(k))) {
  fail("Contagem local mudou; esperado 2 enviados e 639 pendentes");
}
const campaignState = await readStorage("campaigns.json");
const campaigns = campaignState && Array.isArray(campaignState.campaigns) ? campaignState.campaigns : [];
const existing = campaigns.find(c => c.id === CAMPAIGN_ID) || null;
const existingQueue = await readQueue();
if (existingQueue.length && existingQueue.length !== TARGETS) fail("Já há uma fila parcial; conferência manual necessária");
if (existingQueue.length === TARGETS) fail("Fila já existe; não vou reenfileirar nem sincronizar sem reconciliação");
const preview = {
  campaign: CAMPAIGN_ID,
  localStatus: state.status,
  total: state.targetCount,
  alreadySent: counts.sent,
  toQueue: counts.pending,
  queueRowsAlreadyPresent: existingQueue.length,
  channel: "5895",
  provider: "UAZAPI",
  windowBrt: "07:00-19:00",
  pace: "50 no primeiro dia, +10 por dia, teto 641",
  campaignConfigAlreadyPresent: Boolean(existing),
  action: apply ? "apply" : "dry-run",
};
console.log(JSON.stringify(preview));
if (!apply) process.exit(0);

const now = new Date();
const stamp = now.toISOString().replace(/[:.]/g, "-");
await writeStorage("black-friday-desktop-backup-" + stamp + ".json", state);
if (state.status === "running") {
  await writeStorage(STATE_FILE, {
    ...state,
    status: "migrating_to_vps",
    migrationStartedAt: now.toISOString(),
  });
}
if (campaignState) {
  await writeStorage("black-friday-campaigns-backup-" + stamp + ".json", campaignState);
}
const paceStartAt = new Date(state.startDayBrt + "T07:00:00-03:00").toISOString();
const campaign = {
  id: CAMPAIGN_ID,
  name: "Black Friday — Mega Sorgo — 5895",
  template: "(fluxo)",
  language: "pt_BR",
  steps: [],
  flow: {
    startId: "mensagem-black-friday",
    steps: [{ id: "mensagem-black-friday", kind: "text", text: state.message }],
  },
  pace: {
    capInicial: 50,
    capIncremento: 10,
    capMaximo: TARGETS,
    horaInicio: 7,
    horaFim: 19,
  },
  paceStartAt,
  delayMin: 0,
  delayMax: 0,
  createdAt: now.toISOString(),
};
const nextCampaignState = { campaigns: campaigns.filter(c => c.id !== CAMPAIGN_ID).concat(campaign), targets: campaignState?.targets || {} };
await writeStorage("campaigns.json", nextCampaignState);

const rows = state.targets.map((target, index) => {
  const phone = String(target.phone).replace(/\D/g, "");
  const sent = target.status === "sent";
  const sentAt = sent ? (target.sentAt || state.lastSentAt) : null;
  if (sent && !sentAt) fail("Envio local sem horário confirmado");
  return {
    campaign_id: CAMPAIGN_ID,
    contact_key: phone,
    channel_id: CHANNEL_ID,
    status: sent ? "sent" : "pending",
    attempts: 0,
    sent_at: sentAt || null,
    created_at: sentAt || new Date(now.getTime() + index).toISOString(),
    updated_at: now.toISOString(),
  };
});
await request(new URL(queueUrl().toString() + "&on_conflict=campaign_id%2Ccontact_key"), {
  method: "POST",
  headers: { "Accept-Profile": "public", "Content-Profile": "public", "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=minimal" },
  body: JSON.stringify(rows),
});
const finalQueue = await readQueue();
const finalCounts = finalQueue.reduce((out, row) => { out[row.status] = (out[row.status] || 0) + 1; return out; }, {});
if (finalQueue.length !== TARGETS || finalCounts.sent !== 2 || finalCounts.pending !== TARGETS - 2) {
  fail("A fila persistente não fechou em 2 enviados e 639 pendentes; campanha local permanece bloqueada");
}
await writeStorage(STATE_FILE, {
  ...state,
  status: "migrated_to_vps",
  migratedToVpsAt: new Date().toISOString(),
  vpsQueue: finalCounts,
});
console.log(JSON.stringify({ campaign: CAMPAIGN_ID, status: "migrated_to_vps", total: finalQueue.length, sent: finalCounts.sent, pending: finalCounts.pending }));
