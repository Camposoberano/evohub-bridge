#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

export const CAMPAIGN_ID = "isca-embrapa-sul-sudeste-5895-2026-09-25";
export const TOTAL_CONTACTS = 1253;
export const PACE = Object.freeze({
  capInicial: 50,
  capIncremento: 5,
  capMaximo: TOTAL_CONTACTS,
  horaInicio: 8,
  horaFim: 20,
});
const FUNNEL = "mega-sorgo";
const BUCKET = "soberano-config";
const CAMPAIGNS_FILE = "campaigns.json";
const QUEUE_BATCH_SIZE = 500;

function fail(message) {
  throw new Error(message);
}

/** Normaliza uma ou mais entradas para números brasileiros em dígitos. */
export function normalizePhones(input) {
  const values = Array.isArray(input)
    ? input
    : String(input ?? "").split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw) continue;
    // Formatação telefônica é aceita; letras e outros caracteres são erro, não são
    // silenciosamente descartados para evitar uma lista que mudou de significado.
    if (!/^[\d\s()+./-]+$/.test(raw)) {
      // Mantém a entrada inválida no conjunto para que validateCampaignList
      // falhe fechado, em vez de descartá-la e aceitar uma lista adulterada.
      if (!seen.has(raw)) {
        seen.add(raw);
        out.push(raw);
      }
      continue;
    }
    let digits = raw.replace(/\D/g, "");
    // A lista operacional pode trazer telefone nacional formatado (DDD + número).
    // Converte-o para E.164 brasileiro antes de deduplicar.
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    if (!seen.has(digits)) {
      seen.add(digits);
      out.push(digits);
    }
  }
  return out;
}

/** Valida a lista inteira antes de qualquer leitura/escrita operacional. */
export function validateCampaignList(values) {
  const normalized = normalizePhones(values);
  if (normalized.length !== TOTAL_CONTACTS) {
    fail(`lista precisa conter exatamente ${TOTAL_CONTACTS} telefones únicos; recebeu ${normalized.length}`);
  }
  const invalid = normalized.find((phone) => !/^55\d{10,11}$/.test(phone));
  if (invalid) {
    fail(`lista contém telefone brasileiro inválido (quantidade ${normalized.length})`);
  }
  return normalized;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.length === 0) {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (quoted) fail("CSV inválido: aspas não fechadas");
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

export function phonesFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) fail("CSV vazio");
  const header = rows[0].map((v) => String(v).trim().toLowerCase());
  const phoneIndex = header.findIndex((v) => v === "telefone" || v === "phone");
  const data = phoneIndex >= 0 ? rows.slice(1).map((r) => r[phoneIndex] ?? "") : rows.map((r) => r[0] ?? "");
  return validateCampaignList(data);
}

export async function phonesFromCsvFile(csvPath) {
  const path = resolve(String(csvPath ?? ""));
  try {
    const info = await stat(path);
    if (!info.isFile()) fail(`CSV não é um arquivo: ${path}`);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`CSV não encontrado: ${path}`);
    throw error;
  }
  return phonesFromCsv(await readFile(path, "utf8"));
}

export function buildCampaign({ channelId, coverUrl, pdfUrl, now = new Date() }) {
  if (!channelId) fail("canal 5895 sem id");
  if (!coverUrl) fail("capa isca_silagem_capa não encontrada");
  if (!pdfUrl) fail("PDF isca_silagem não encontrado");
  const flow = {
    startId: "oferta",
    steps: [
      {
        id: "oferta",
        kind: "buttons",
        text: "🌾 O senhor tem interesse em receber, de graça, um material da Embrapa com o passo a passo pra fazer uma silagem de qualidade? 📚",
        imageUrl: coverUrl,
        buttons: [
          { id: "quero", title: "Quero o material 📩" },
          { id: "nao", title: "Agora não" },
        ],
        branches: { quero: "quero", nao: "nao" },
        fallbackNext: "nao",
      },
      {
        id: "quero",
        kind: "media",
        text: "📚 Material gratuito — Silagem de Sorgo, desenvolvido pela Embrapa.\n\nBom proveito e boa safra! 🌱",
        media: { type: "document", url: pdfUrl, fileName: "Silagem-de-Sorgo-Embrapa.pdf" },
        labels: ["interesse-silagem"],
        next: "quero-fim",
      },
      { id: "quero-fim", kind: "end", outcome: "won" },
      {
        id: "nao",
        kind: "text",
        text: "Tranquilo! 👍 Se mudar de ideia é só me chamar que eu envio o material na hora.",
        next: "nao-fim",
      },
      { id: "nao-fim", kind: "end", outcome: "lost" },
    ],
  };
  return {
    id: CAMPAIGN_ID,
    name: "Isca Embrapa — Sul/Sudeste — 5895",
    template: "(fluxo)",
    language: "pt_BR",
    steps: [],
    flow,
    pace: { ...PACE },
    delayMin: 0,
    delayMax: 0,
    createdAt: new Date(now).toISOString(),
  };
}

function envFromFile(text) {
  const result = {};
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[m[1]] = value;
  }
  return result;
}

export async function loadEnv(cwd = process.cwd()) {
  const values = { ...process.env };
  try {
    Object.assign(values, envFromFile(await readFile(resolve(cwd, ".env"), "utf8")));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return values;
}

export function createRestClient({ url, key, schema = "evohub", fetchImpl = fetch }) {
  if (!url || !key) fail("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios para --apply");
  const base = String(url).replace(/\/+$/, "");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "Accept-Profile": schema,
    "Content-Profile": schema,
  };
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!response.ok) fail(`Supabase ${response.status}: ${typeof body === "string" ? body.slice(0, 160) : body?.message ?? "erro"}`);
    return body;
  }
  return {
    select: (table, query = "") => request(`/rest/v1/${table}${query ? `?${query}` : ""}`),
    uploadJson: (bucket, file, value) => request(`/storage/v1/object/${bucket}/${file}`, {
      method: "POST",
      headers: { "x-upsert": "true", "Content-Type": "application/json" },
      body: JSON.stringify(value),
    }),
    upsert: (table, rows, onConflict = "") => request(`/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ""}`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    }),
    downloadJson: async (bucket, file) => {
      try { return await request(`/storage/v1/object/${bucket}/${file}`); } catch (error) {
        if (String(error?.message ?? error).includes("Supabase 404")) return null;
        throw error;
      }
    },
  };
}

async function discover(client) {
  const channels = await client.select("channels", "select=id,name,type,status,phone_number,phone_number_id&limit=200");
  const matches = (channels ?? []).filter((row) => {
    if (String(row.type ?? "").toLowerCase() !== "whatsapp") return false;
    const values = [row.name, row.phone_number, row.display_name, row.phone_number_id].map((v) => String(v ?? "").trim());
    return values.includes("5895");
  });
  if (matches.length !== 1) fail(matches.length ? "mais de um canal WhatsApp corresponde a 5895" : "canal WhatsApp 5895 não encontrado");
  const channel = matches[0];
  const media = await client.select("funnel_media", "select=slot,url,type&funnel=eq.mega-sorgo&active=eq.true&slot=in.(isca_silagem_capa,isca_silagem)&limit=50");
  const cover = (media ?? []).find((row) => row.slot === "isca_silagem_capa" && row.url);
  const pdf = (media ?? []).find((row) => row.slot === "isca_silagem" && row.url);
  if (!cover) fail("capa isca_silagem_capa não encontrada");
  if (!pdf) fail("PDF isca_silagem não encontrado");
  return { channel, coverUrl: String(cover.url), pdfUrl: String(pdf.url) };
}

function queueRows(campaign, phones) {
  return phones.map((contact_key) => ({ campaign_id: campaign.id, contact_key, channel_id: campaign.channelId, status: "pending" }));
}

export async function prepareCampaign({ csvPath, apply = false, client, now = new Date(), env = {}, output = console.log }) {
  if (!csvPath) fail("informe --csv com a lista operacional; nenhum dado será escrito");
  const phones = await phonesFromCsvFile(csvPath);
  if (!client) client = createRestClient({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, schema: env.SUPABASE_SCHEMA ?? "evohub" });
  const found = await discover(client);
  const campaign = buildCampaign({ channelId: found.channel.id, coverUrl: found.coverUrl, pdfUrl: found.pdfUrl, now });
  campaign.channelId = found.channel.id;

  if (!apply) {
    const report = { campaignId: CAMPAIGN_ID, channelId: found.channel.id, total: phones.length, pdfFound: true, coverFound: true, pace: { ...PACE } };
    output(JSON.stringify(report));
    return report;
  }

  const state = (await client.downloadJson(BUCKET, CAMPAIGNS_FILE)) ?? { campaigns: [], targets: {} };
  if (!Array.isArray(state.campaigns)) state.campaigns = [];
  if (state.campaigns.some((item) => item?.id === CAMPAIGN_ID)) fail(`campanha ${CAMPAIGN_ID} já existe`);
  const existingQueue = await client.select("campaign_queue", `select=status&campaign_id=eq.${encodeURIComponent(CAMPAIGN_ID)}&limit=2000`);
  if ((existingQueue ?? []).some((row) => String(row.status) !== "skipped")) fail(`já existem itens não cancelados para ${CAMPAIGN_ID}`);

  state.campaigns.push(campaign);
  delete campaign.channelId;
  await client.uploadJson(BUCKET, CAMPAIGNS_FILE, state);
  const rows = queueRows({ ...campaign, channelId: found.channel.id }, phones);
  for (let i = 0; i < rows.length; i += QUEUE_BATCH_SIZE) await client.upsert("campaign_queue", rows.slice(i, i + QUEUE_BATCH_SIZE), "campaign_id,contact_key");
  const check = await client.select("campaign_queue", `select=status&campaign_id=eq.${encodeURIComponent(CAMPAIGN_ID)}&limit=2000`);
  if ((check ?? []).length !== TOTAL_CONTACTS || (check ?? []).some((row) => row.status !== "pending")) fail(`verificação da fila falhou: esperado ${TOTAL_CONTACTS} pendentes`);
  const report = { campaignId: CAMPAIGN_ID, channelId: found.channel.id, total: phones.length, queued: TOTAL_CONTACTS, status: "pending", pace: { ...PACE } };
  output(JSON.stringify(report));
  return report;
}

function parseArgs(argv) {
  const args = { apply: false, csvPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--dry-run") args.apply = false;
    else if (argv[i] === "--csv") args.csvPath = argv[++i];
    else fail(`argumento desconhecido: ${argv[i]}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const environment = await loadEnv();
  await prepareCampaign({ csvPath: args.csvPath, apply: args.apply, env: environment });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`prepare-isca-campaign: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
