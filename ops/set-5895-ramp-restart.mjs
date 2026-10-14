#!/usr/bin/env node
// Reinicia somente a rampa da campanha Embrapa 5895; dry-run por padrão.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv, CAMPAIGN_ID } from './prepare-isca-campaign.mjs';

const restartAt = '2026-10-14T11:00:00.000Z'; // 08h Fortaleza
const apply = process.argv.includes('--apply');
const env = await loadEnv();
const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!base || !key) throw new Error('Supabase não configurado');
const url = `${base}/storage/v1/object/soberano-config/campaigns.json`;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function readState() {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`campaigns.json HTTP ${response.status}`);
  return await response.json();
}
function checkedCampaign(state) {
  const campaigns = state.campaigns?.filter(row => row.id === CAMPAIGN_ID) ?? [];
  if (campaigns.length !== 1) throw new Error('Campanha Embrapa ausente ou duplicada');
  const campaign = campaigns[0];
  if (campaign.createdAt !== '2026-09-25T11:00:00.000Z' ||
      campaign.flow?.startId !== 'oferta' ||
      campaign.pace?.capInicial !== 50 || campaign.pace?.capIncremento !== 5 ||
      campaign.pace?.horaInicio !== 8 || campaign.pace?.horaFim !== 20) {
    throw new Error('Configuração da campanha mudou; revisar manualmente');
  }
  if (campaign.paceStartAt && campaign.paceStartAt !== restartAt) {
    throw new Error('Rampa já tem outro início; revisar manualmente');
  }
  return campaign;
}

const state = await readState();
const campaign = checkedCampaign(state);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', campaign: CAMPAIGN_ID,
  createdAt: campaign.createdAt, paceStartAtBefore: campaign.paceStartAt ?? null,
  paceStartAtAfter: restartAt, pace: campaign.pace }));
if (!apply || campaign.paceStartAt === restartAt) process.exit(0);
if (Date.now() >= Date.parse(restartAt)) throw new Error('A janela de retomada já começou');

// Uma segunda leitura reduz a chance de sobrescrever uma edição concorrente do arquivo.
const current = await readState();
if (JSON.stringify(current) !== JSON.stringify(state)) throw new Error('campaigns.json mudou durante a revisão');
checkedCampaign(current).paceStartAt = restartAt;
const backupDir = resolve('ops', 'backups');
await mkdir(backupDir, { recursive: true });
const backupPath = resolve(backupDir, `campaigns-5895-before-ramp-reset-${Date.now()}.json`);
await writeFile(backupPath, JSON.stringify(state, null, 2));
const upload = await fetch(url, {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json', 'x-upsert': 'true' },
  body: JSON.stringify(current),
  signal: AbortSignal.timeout(30000),
});
if (!upload.ok) throw new Error(`upload campaigns.json HTTP ${upload.status}`);
const after = await readState();
if (checkedCampaign(after).paceStartAt !== restartAt) throw new Error('Rampa não foi confirmada após escrita');
console.log(JSON.stringify({ applied: true, backupPath, paceStartAt: restartAt }));
