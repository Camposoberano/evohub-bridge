#!/usr/bin/env node
// monitor-reativacao — acompanha as campanhas de reativação: disparos, funil e eventos.
//
// Uso: EVOHUB_ENV_PATH=.../.env node ops/monitor-reativacao.mjs
// Só LÊ (nada escreve). Agrega:
//  - fila por campanha (pending/sent/failed/skipped/paused + enviados hoje)
//  - funil via campaign_flow_state (abertura=enviado sem clique · área=clicou/viu vídeo · done=fechou)
//  - eventos 24h (pediu_humano/handoff, bloqueios por etiqueta, falhas, segurados por janela)
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CAMPANHAS = [
  "reativacao-5895-of", "reativacao-6836-of",
  "reativacao-5895-uz", "reativacao-6836-uz", "reativacao-0595-uz",
];

function envFromFile(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
async function loadEnv() {
  const values = { ...process.env };
  const cands = [];
  if (process.env.EVOHUB_ENV_PATH) cands.push(process.env.EVOHUB_ENV_PATH);
  cands.push(resolve(process.cwd(), ".env"), resolve(process.cwd(), "..", ".env"));
  for (const p of cands) {
    try { Object.assign(values, envFromFile(await readFile(p, "utf8"))); break; } catch (e) { if (e?.code !== "ENOENT") throw e; }
  }
  return values;
}

const BRT_OFFSET = 3 * 3600e3;
function inicioDiaBrt(now = Date.now()) {
  const brt = new Date(now - BRT_OFFSET); brt.setUTCHours(0, 0, 0, 0);
  return new Date(brt.getTime() + BRT_OFFSET).toISOString();
}

async function main() {
  const env = await loadEnv();
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) { console.error("faltam SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  const diaBrt = inicioDiaBrt();

  async function scan(table, select, extra = "") {
    const out = [];
    for (let from = 0; from < 200000; from += 1000) {
      const r = await fetch(`${base}/rest/v1/${table}?select=${select}${extra ? "&" + extra : ""}`, { headers: { ...H, Range: `${from}-${from + 999}` } });
      if (!r.ok) throw new Error(`${table} ${r.status}`);
      const rows = await r.json(); if (!Array.isArray(rows) || !rows.length) break;
      out.push(...rows); if (rows.length < 1000) break;
    }
    return out;
  }
  const inFilter = (col) => `${col}=in.(${CAMPANHAS.map(encodeURIComponent).join(",")})`;

  const nowBrt = new Date(Date.now() - BRT_OFFSET).toISOString().slice(11, 16);
  const janela = (() => { const h = new Date(Date.now() - BRT_OFFSET).getUTCHours(); return h >= 8 && h < 18; })();
  console.log(`\n=== Monitor reativação · ${nowBrt} BRT · janela 8-18h: ${janela ? "ABERTA" : "fechada"} ===\n`);

  // 1) fila por campanha
  const fila = await scan("campaign_queue", "campaign_id,status,sent_at", inFilter("campaign_id"));
  const porCamp = {};
  for (const r of fila) {
    const c = (porCamp[r.campaign_id] ||= { pending: 0, sent: 0, failed: 0, skipped: 0, paused: 0, processing: 0, hoje: 0, total: 0 });
    c[r.status] = (c[r.status] || 0) + 1; c.total++;
    if (r.status === "sent" && r.sent_at && r.sent_at >= diaBrt) c.hoje++;
  }
  console.log("DISPAROS por campanha");
  console.log("campanha".padEnd(20), "total  envHoje  enviado  pend   falha  pulado");
  for (const id of CAMPANHAS) {
    const c = porCamp[id] || { total: 0, hoje: 0, sent: 0, pending: 0, failed: 0, skipped: 0 };
    console.log(id.padEnd(20), String(c.total).padStart(5), String(c.hoje).padStart(8), String(c.sent).padStart(8), String(c.pending).padStart(6), String(c.failed).padStart(6), String(c.skipped).padStart(7));
  }

  // 2) funil via flow_state
  const fs = await scan("campaign_flow_state", "campaign_id,step_id,status", inFilter("campaign_id"));
  const funil = {};
  for (const r of fs) {
    const c = (funil[r.campaign_id] ||= { abertura: 0, clicou: 0, area: 0, done: 0 });
    if (r.step_id === "abertura") c.abertura++;
    else if (r.step_id === "area") { c.clicou++; c.area++; }
    else if (!r.step_id || r.status === "done") { c.clicou++; c.done++; }
    else c.clicou++;
  }
  console.log("\nFUNIL por campanha (de quem recebeu o abridor)");
  console.log("campanha".padEnd(20), "recebeu  s/clique  clicou  na área  fechou");
  for (const id of CAMPANHAS) {
    const f = funil[id]; if (!f) { console.log(id.padEnd(20), "  —"); continue; }
    const recebeu = f.abertura + f.clicou;
    console.log(id.padEnd(20), String(recebeu).padStart(7), String(f.abertura).padStart(9), String(f.clicou).padStart(7), String(f.area).padStart(8), String(f.done).padStart(7));
  }

  // 3) eventos 24h
  const desde = new Date(Date.now() - 24 * 3600e3).toISOString();
  const ev = await scan("events", "event_type,occurred_at", `occurred_at=gte.${desde}&event_type=in.(pediu_humano,envio_bloqueado_etiqueta,message_failed,message_held_window)`);
  const cont = {};
  for (const e of ev) cont[e.event_type] = (cont[e.event_type] || 0) + 1;
  console.log("\nEVENTOS (24h, todas as campanhas)");
  for (const k of ["pediu_humano", "envio_bloqueado_etiqueta", "message_failed", "message_held_window"]) {
    console.log("  " + k.padEnd(26), cont[k] || 0);
  }
  console.log("");
}
main().catch((e) => { console.error("monitor:", e?.message || e); process.exitCode = 1; });
