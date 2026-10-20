#!/usr/bin/env node
// prepare-reativacao-campaign — monta a campanha de reativação dos leads frios (Mega Sorgo).
//
// Abre a janela fria pelo OFICIAL com um template aprovado (header de imagem + botão); no
// clique, o flow entrega o vídeo de resultados (video_3) e oferece cotação com humano.
// O motor (pump da campaign_queue + flow-runner com o novo step kind "template") roda isso
// sozinho dentro de 8–20h, no ritmo da rampa.
//
// Uso:
//   node ops/prepare-reativacao-campaign.mjs            # dry-run: só relata a lista e o flow
//   node ops/prepare-reativacao-campaign.mjs --apply    # grava a campanha e enfileira (pede template APROVADO)
//
// NADA é enviado por este script: ele só enfileira. O disparo é do loop da bridge, dentro
// da janela, e depende da campanha existir em campaigns.json. Sem --apply, não escreve nada.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ───────────────────────── CONFIG (editar aqui) ─────────────────────────
const CFG = {
  campaignId: "reativacao-video-frios-2026",
  campaignName: "Reativação — vídeo resultados — frios",
  channelMatch: "5895", // canal WhatsApp oficial
  // Template aprovado na Meta (Business Manager). Trocar pelo nome real quando aprovar.
  templateName: process.env.REATIVACAO_TEMPLATE ?? "reativacao_video_2026",
  templateLanguage: "pt_BR",
  headerSlot: "producao_img", // imagem do header do template (lembrança de marca)
  videoSlot: "video_3", // vídeo entregue no clique (resultados reais)
  funnel: "mega-sorgo",
  // Copy do CTA pós-vídeo (texto livre, dentro da janela já aberta). Sem preço automático.
  ctaPergunta: "Quer que eu veja o melhor pacote e o preço certo pra sua área? 🌱",
  ctaSim: "Quero cotação 💬",
  ctaNao: "Agora não",
  ctaConfirma: "Perfeito! Já vou te passar pro nosso especialista pra fechar os detalhes. 👨‍🌾",
  ctaAck: "Tranquilo! Qualquer dúvida é só me chamar aqui. 👍",
  labelInteresse: "interesse-video",
  // Ritmo conservador: lista fria grande derruba quality rating se sair em rajada.
  pace: { horaInicio: 8, horaFim: 20, capInicial: 50, capIncremento: 5, capMaximo: 7000 },
};

// Nordeste menos Bahia sai (8 estados). Mantém BA; sobram 19 estados.
const REMOVE_UF = new Set(["MA", "PI", "CE", "RN", "PB", "PE", "AL", "SE"]);
// Prioridade de disparo: Sul e Sudeste primeiro, Nordeste (BA) por último.
const REGION_ORDER = ["Sul", "Sudeste", "CentroOeste", "Norte", "Nordeste"];
const REGION = {
  SP: "Sudeste", RJ: "Sudeste", MG: "Sudeste", ES: "Sudeste",
  PR: "Sul", SC: "Sul", RS: "Sul",
  MT: "CentroOeste", MS: "CentroOeste", GO: "CentroOeste", DF: "CentroOeste",
  AC: "Norte", AP: "Norte", AM: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  BA: "Nordeste",
};
const DDD_UF = {
  11:"SP",12:"SP",13:"SP",14:"SP",15:"SP",16:"SP",17:"SP",18:"SP",19:"SP",21:"RJ",22:"RJ",24:"RJ",
  27:"ES",28:"ES",31:"MG",32:"MG",33:"MG",34:"MG",35:"MG",37:"MG",38:"MG",41:"PR",42:"PR",43:"PR",
  44:"PR",45:"PR",46:"PR",47:"SC",48:"SC",49:"SC",51:"RS",53:"RS",54:"RS",55:"RS",61:"DF",62:"GO",
  64:"GO",63:"TO",65:"MT",66:"MT",67:"MS",68:"AC",69:"RO",71:"BA",73:"BA",74:"BA",75:"BA",77:"BA",
  79:"SE",81:"PE",87:"PE",82:"AL",83:"PB",84:"RN",85:"CE",88:"CE",86:"PI",89:"PI",91:"PA",93:"PA",
  94:"PA",92:"AM",97:"AM",95:"RR",96:"AP",98:"MA",99:"MA",
};
const WON = new Set(["pago", "pagamento feito", "pedido finalizado", "venda"]);
const LOST = new Set(["nao compra", "nao tem interesse", "sem interesse"]);
const BUCKET = "soberano-config";
const CAMPAIGNS_FILE = "campaigns.json";
const QUEUE_BATCH = 500;

function fail(msg) { throw new Error(msg); }

// ── helpers ──
const last11 = (s) => String(s || "").replace(/\D/g, "").slice(-11);
const digits = (s) => String(s || "").replace(/\D/g, "");
function toE164(phone) {
  let d = digits(phone);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d;
}
function canon(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[-_\s]+/g, " ").trim();
}
function ufDe(phone) {
  let d = digits(phone);
  if (d.startsWith("55")) d = d.slice(2);
  return DDD_UF[Number(d.slice(0, 2))] ?? null;
}

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
async function loadEnv(cwd = process.cwd()) {
  const values = { ...process.env };
  // EVOHUB_ENV_PATH aponta o .env direto (útil em worktree, onde o .env real mora no
  // checkout principal). Senão tenta cwd e os pais.
  const candidatos = [];
  if (process.env.EVOHUB_ENV_PATH) candidatos.push(process.env.EVOHUB_ENV_PATH);
  candidatos.push(resolve(cwd, ".env"), resolve(cwd, "..", ".env"), resolve(cwd, "..", "..", ".env"));
  for (const path of candidatos) {
    try {
      Object.assign(values, envFromFile(await readFile(path, "utf8")));
      break;
    } catch (e) { if (e?.code !== "ENOENT") throw e; }
  }
  return values;
}

// Cliente REST no schema DEFAULT (todas estas tabelas vivem no default, não em "evohub").
function rest(env) {
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) fail("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios");
  const H = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    base, key, H,
    async scan(table, select, extra = "") {
      const out = [];
      for (let from = 0; from < 200000; from += 1000) {
        const r = await fetch(`${base}/rest/v1/${table}?select=${select}${extra ? "&" + extra : ""}`,
          { headers: { ...H, Range: `${from}-${from + 999}` } });
        if (!r.ok) fail(`scan ${table} HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
        const rows = await r.json();
        if (!Array.isArray(rows) || !rows.length) break;
        out.push(...rows);
        if (rows.length < 1000) break;
      }
      return out;
    },
    async storageDownloadJson(file) {
      const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${file}`, { headers: H });
      if (r.status === 404) return null;
      if (!r.ok) fail(`storage download ${file} HTTP ${r.status}`);
      return await r.json().catch(() => null);
    },
    async storageUploadJson(file, value) {
      const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${file}`, {
        method: "POST",
        headers: { ...H, "x-upsert": "true", "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (!r.ok) fail(`storage upload ${file} HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    },
    async enqueue(rows) {
      const r = await fetch(`${base}/rest/v1/campaign_queue?on_conflict=campaign_id,contact_key`, {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) fail(`enqueue HTTP ${r.status}: ${(await r.text()).slice(0, 160)}`);
    },
  };
}

// ── deriva os 6.608 ao vivo, ordenados por região ──
async function deriveTargets(db) {
  const [clientes, contacts, convs, cq, inb] = await Promise.all([
    db.scan("clientes", "phone,lead_tags"),
    db.scan("contacts", "id,phone,external_contact_id"),
    db.scan("conversations", "id,contact_id,outcome,labels"),
    db.scan("campaign_queue", "contact_key,status"),
    db.scan("messages", "conversation_id", "direction=eq.in"),
  ]);

  const cidKey = new Map();
  for (const c of contacts) {
    const k = last11(c.phone) || last11(c.external_contact_id);
    if (k) cidKey.set(String(c.id), k);
  }
  const pago = new Set(), nao = new Set(), safr = new Set();
  for (const cv of convs) {
    const key = cidKey.get(String(cv.contact_id));
    if (!key) continue;
    if (cv.outcome === "won") pago.add(key);
    if (cv.outcome === "lost") nao.add(key);
    for (const l of (Array.isArray(cv.labels) ? cv.labels : [])) {
      const bare = String(l).startsWith("wa:") ? String(l).slice(3) : String(l);
      const c = canon(bare);
      if (WON.has(c)) pago.add(key);
      if (LOST.has(c)) nao.add(key);
      if (c.includes("safrinha")) safr.add(key);
    }
  }
  const sent = new Set();
  for (const q of cq) if (q.status === "sent") sent.add(last11(q.contact_key));
  const convCid = new Map(convs.map((cv) => [String(cv.id), String(cv.contact_id)]));
  const respondeu = new Set();
  for (const x of inb) {
    const cid = convCid.get(String(x.conversation_id));
    const key = cid && cidKey.get(cid);
    if (key) respondeu.add(key);
  }

  const porRegiao = Object.fromEntries(REGION_ORDER.map((r) => [r, []]));
  for (const cl of clientes) {
    const uf = ufDe(cl.phone);
    if (!uf || REMOVE_UF.has(uf)) continue; // só os 19 estados
    const key = last11(cl.phone);
    if (pago.has(key) || nao.has(key) || safr.has(key)) continue; // fora etiquetados
    if (respondeu.has(key)) continue; // fora quem já respondeu
    if (sent.has(key)) continue; // fora quem já recebeu disparo efetivo
    porRegiao[REGION[uf]].push({ phone: toE164(cl.phone), uf });
  }
  // Ordem de disparo: região por região (o pump pega por ordem de inserção).
  const ordered = [];
  const resumo = {};
  for (const reg of REGION_ORDER) {
    const lista = porRegiao[reg];
    resumo[reg] = lista.length;
    ordered.push(...lista);
  }
  // dedup preservando ordem (um telefone não entra duas vezes)
  const seen = new Set();
  const phones = [];
  for (const { phone } of ordered) {
    if (phone.length < 12) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    phones.push(phone);
  }
  return { phones, resumo };
}

// ── descobre canal + mídias + confere template ──
async function discover(db, env) {
  const canais = await db.scan("channels", "id,name,phone_number,phone_number_id,waba_id,type,status");
  const canal = canais.find((c) =>
    String(c.type).toLowerCase() === "whatsapp" &&
    [c.name, c.phone_number, c.phone_number_id].map((v) => String(v ?? "")).some((v) => v.includes(CFG.channelMatch))
  );
  if (!canal) fail(`canal WhatsApp ${CFG.channelMatch} não encontrado`);
  if (!canal.phone_number_id) fail(`canal ${CFG.channelMatch} sem phone_number_id (oficial)`);

  const media = await db.scan("funnel_media", "slot,url,type,active",
    `funnel=eq.${CFG.funnel}&active=eq.true&slot=in.(${CFG.videoSlot},${CFG.headerSlot})`);
  const video = media.find((m) => m.slot === CFG.videoSlot && m.url);
  const header = media.find((m) => m.slot === CFG.headerSlot && m.url);
  if (!video) fail(`slot de vídeo ${CFG.videoSlot} ausente/inativo`);
  if (!header) fail(`slot de imagem ${CFG.headerSlot} ausente/inativo`);

  // Confere que o template existe e está APROVADO na WABA deste canal.
  let templateStatus = "DESCONHECIDO";
  const metaToken = env.META_ACCESS_TOKEN;
  if (metaToken && canal.waba_id) {
    const graph = env.META_GRAPH_VERSION || "v21.0";
    const r = await fetch(`https://graph.facebook.com/${graph}/${canal.waba_id}/message_templates?limit=200&fields=name,status,language`,
      { headers: { Authorization: `Bearer ${metaToken}` } });
    if (r.ok) {
      const d = await r.json();
      const t = (d.data || []).find((x) => x.name === CFG.templateName);
      templateStatus = t ? `${t.status} (${t.language})` : "NÃO EXISTE";
    } else {
      templateStatus = `erro Graph ${r.status}`;
    }
  }
  return { canal, videoUrl: String(video.url), headerUrl: String(header.url), templateStatus };
}

// ── monta o flow (mesma forma do teste reativacao-flow.test.ts) ──
function buildFlow(videoUrl, headerUrl) {
  return {
    startId: "abertura",
    steps: [
      {
        id: "abertura",
        kind: "template",
        template: {
          name: CFG.templateName,
          language: CFG.templateLanguage,
          headerMedia: { type: "image", url: headerUrl },
        },
        fallbackNext: "video", // clique do template chega sem id de botão -> vai pro vídeo
      },
      { id: "video", kind: "media", media: { type: "video", url: videoUrl },
        text: "🎥 Dá uma olhada no resultado real no campo 👇", delaySeg: 1, next: "cta" },
      { id: "cta", kind: "buttons", text: CFG.ctaPergunta,
        buttons: [{ id: "cotar", title: CFG.ctaSim }, { id: "depois", title: CFG.ctaNao }],
        branches: { cotar: "cotar", depois: "ack" }, fallbackNext: "cotar" },
      { id: "cotar", kind: "text", text: CFG.ctaConfirma, labels: [CFG.labelInteresse], next: "fim" },
      { id: "fim", kind: "end" },
      { id: "ack", kind: "text", text: CFG.ctaAck, next: "fim2" },
      { id: "fim2", kind: "end" },
    ],
  };
}

function buildCampaign(flow) {
  return {
    id: CFG.campaignId,
    name: CFG.campaignName,
    template: "(fluxo)", // o abridor de verdade é o step kind "template" dentro do flow
    language: CFG.templateLanguage,
    steps: [],
    flow,
    pace: { ...CFG.pace },
    delayMin: 0,
    delayMax: 0,
    createdAt: new Date().toISOString(),
  };
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const env = await loadEnv();
  const db = rest(env);

  const { phones, resumo } = await deriveTargets(db);
  const found = await discover(db, env);
  const flow = buildFlow(found.videoUrl, found.headerUrl);
  const campaign = buildCampaign(flow);

  console.log("=== Campanha de reativação (dry-run) ===");
  console.log("campanha:", campaign.id);
  console.log("canal:", found.canal.name, found.canal.phone_number, "| waba:", found.canal.waba_id);
  console.log("template:", CFG.templateName, "->", found.templateStatus);
  console.log("vídeo:", CFG.videoSlot, "| header:", CFG.headerSlot);
  console.log("ritmo:", JSON.stringify(CFG.pace));
  console.log("--- lista por região (ordem de disparo) ---");
  for (const reg of REGION_ORDER) console.log(`  ${reg.padEnd(12)} ${resumo[reg]}`);
  console.log("TOTAL a enfileirar:", phones.length);
  console.log("amostra:", phones.slice(0, 3).map((p) => p.slice(-4)).join(" "), "...");

  if (!apply) {
    console.log("\n(dry-run) nada foi gravado. Rode com --apply para criar e enfileirar.");
    return;
  }

  // ── apply: trava dura ──
  if (!/^APPROVED/.test(found.templateStatus)) {
    fail(`--apply recusado: template "${CFG.templateName}" não está APPROVED (está: ${found.templateStatus}). Crie/aprove no Meta Business Manager primeiro.`);
  }
  if (!phones.length) fail("--apply recusado: lista vazia");

  const state = (await db.storageDownloadJson(CAMPAIGNS_FILE)) ?? { campaigns: [], targets: {} };
  if (!Array.isArray(state.campaigns)) state.campaigns = [];
  if (state.campaigns.some((c) => c?.id === campaign.id)) {
    fail(`--apply recusado: campanha ${campaign.id} já existe em campaigns.json`);
  }
  const existing = await db.scan("campaign_queue", "status", `campaign_id=eq.${encodeURIComponent(campaign.id)}`);
  if (existing.some((r) => r.status !== "skipped")) {
    fail(`--apply recusado: já há itens não-skipped na fila de ${campaign.id}`);
  }

  state.campaigns.push(campaign);
  await db.storageUploadJson(CAMPAIGNS_FILE, state);
  const rows = phones.map((contact_key) => ({
    campaign_id: campaign.id, contact_key, channel_id: found.canal.id, status: "pending",
  }));
  for (let i = 0; i < rows.length; i += QUEUE_BATCH) await db.enqueue(rows.slice(i, i + QUEUE_BATCH));

  const check = await db.scan("campaign_queue", "status", `campaign_id=eq.${encodeURIComponent(campaign.id)}`);
  const pend = check.filter((r) => r.status === "pending").length;
  console.log(`\n(apply) campanha gravada e ${pend} contatos enfileirados (pending).`);
  console.log("O disparo começa no próximo tick do loop da bridge, dentro de 8–20h BRT.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`prepare-reativacao-campaign: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}

export { buildFlow, buildCampaign, deriveTargets, CFG };
