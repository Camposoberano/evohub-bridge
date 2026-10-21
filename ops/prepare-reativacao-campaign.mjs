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
  headerSlot: "reativacao_header", // slot dedicado (cand_10 limpa); não mexe no producao_img do funil
  videoSlot: "video_3", // vídeo entregue no clique (resultados reais)
  funnel: "mega-sorgo",
  // Qualificação pós-vídeo (texto livre, dentro da janela já aberta). Sem preço automático:
  // escolher a área registra o pacote e chama o Cícero, igual ao funil ramificado.
  // abridor uazapi (não-oficial, sem template): cartão imagem + botão. Corpo = copy C.
  aberturaUazapiTexto: "Tem produtor colhendo silagem de qualidade o ano todo com o Mega Sorgo Santa Elisa. Gravei um vídeo com os resultados — quer dar uma olhada?",
  videoLegenda: "🎥 Dá uma olhada no resultado real no campo 👇",
  areaPergunta: "📐 Pra eu já separar o volume certo: *qual área você pretende plantar?*",
  // 1 ha → 4 kg, 2 ha → 10 kg, 4 ha → 20 kg; acima disso vai pra cotação com o Cícero.
  pacotes: {
    "1": { kg: 4, cobre: "1 hectare" },
    "2": { kg: 10, cobre: "2 hectares" },
    "4": { kg: 20, cobre: "4 hectares" },
  },
  maiorTexto: "Pra área acima de 4 hectares, me diga *quantos hectares* e sua *região (município/UF)* que o Cícero calcula o volume e a cotação exata. 👨‍🌾",
  labels: ["interesse-video", "cotacao"],
  // Ritmo: começa 25/dia, +5/dia, teto 100. Janela 8–18h. O motor (campaign-pace.intervaloMs)
  // espalha o cap do dia igualmente na janela — sem intervalo fixo, adapta conforme o cap cresce.
  pace: { horaInicio: 8, horaFim: 18, capInicial: 25, capIncremento: 5, capMaximo: 100 },
};

// Multi-disparador: 5 senders paralelos (2 oficiais + 3 uazapi), cada um = 1 campanha com seu
// canal + abridor + ritmo próprio (o pump roda todas em paralelo). Oficiais pegam as fatias
// fixas do topo da lista (melhores regiões); os uazapi dividem o resto igualmente.
const SENDERS = [
  { key: "reativacao-5895-of", channelName: "5895", opener: "template", fixo: 1500 },
  { key: "reativacao-6836-of", channelName: "6836", opener: "template", fixo: 1500 },
  { key: "reativacao-5895-uz", channelName: "5895", opener: "buttons" },
  { key: "reativacao-6836-uz", channelName: "6836", opener: "buttons" },
  { key: "reativacao-0595-uz", channelName: "0595", opener: "buttons" },
];

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

// Texto do pacote, sem preço — o Cícero confirma o valor (regra do dono).
function textoPacote(kg, cobre) {
  return `🌱 *Opção de ${kg} kg — atende ${cobre}.*\n\n🚚 *Frete grátis.*\n💸 Desconto progressivo conforme a quantidade, podendo chegar a *30% em pedidos acima de 100 kg*.\n\nJá anotei aqui e o Cícero confirma o valor exato pro seu pedido. 👨‍🌾`;
}

// Abridor: oficial = template (abre janela fria, pago); uazapi = botões nativos (sem janela,
// grátis). O resto do flow é idêntico. flow-runner já manda cada um pela rota certa (template
// só oficial; botões uazapi-first).
function abertura(openerType, headerUrl) {
  if (openerType === "template") {
    return {
      id: "abertura", kind: "template",
      template: { name: CFG.templateName, language: CFG.templateLanguage, headerMedia: { type: "image", url: headerUrl } },
      fallbackNext: "video", // clique do template chega sem id de botão
    };
  }
  // uazapi: cartão com imagem + 1 botão; clique vai pro vídeo
  return {
    id: "abertura", kind: "buttons",
    text: CFG.aberturaUazapiTexto, imageUrl: headerUrl,
    buttons: [{ id: "ver", title: "Quero ver o vídeo" }],
    branches: { ver: "video" }, fallbackNext: "video",
  };
}

// ── monta o flow (abridor → vídeo → qualifica área → pacote → handoff Cícero) ──
function buildFlow(openerType, videoUrl, headerUrl) {
  const p = CFG.pacotes;
  return {
    startId: "abertura",
    steps: [
      abertura(openerType, headerUrl),
      { id: "video", kind: "media", media: { type: "video", url: videoUrl },
        text: CFG.videoLegenda, delaySeg: 1, next: "area" },
      // Qualifica pela área. Lista (não botões) porque são 4 opções e o WhatsApp só aceita 3 botões.
      { id: "area", kind: "list", text: CFG.areaPergunta,
        sections: [{ title: "Sua área", rows: [
          { id: "area_1", title: "1 hectare", description: `≈ ${p["1"].kg} kg de semente` },
          { id: "area_2", title: "2 hectares", description: `≈ ${p["2"].kg} kg de semente` },
          { id: "area_4", title: "4 hectares", description: `≈ ${p["4"].kg} kg de semente` },
          { id: "area_mais", title: "Mais de 4 hectares", description: "a gente calcula junto" },
        ] }],
        branches: { area_1: "pac1", area_2: "pac2", area_4: "pac4", area_mais: "maior" },
        fallbackNext: "maior" }, // texto livre: trata como área a definir
      // Cada escolha registra o pacote, chama o Cícero (pedirHumano) e encerra o fluxo.
      { id: "pac1", kind: "text", text: textoPacote(p["1"].kg, p["1"].cobre), labels: CFG.labels,
        pedirHumano: true, handoffContexto: { area_hectares: 1, pacote_kg: p["1"].kg }, next: "fim" },
      { id: "pac2", kind: "text", text: textoPacote(p["2"].kg, p["2"].cobre), labels: CFG.labels,
        pedirHumano: true, handoffContexto: { area_hectares: 2, pacote_kg: p["2"].kg }, next: "fim" },
      { id: "pac4", kind: "text", text: textoPacote(p["4"].kg, p["4"].cobre), labels: CFG.labels,
        pedirHumano: true, handoffContexto: { area_hectares: 4, pacote_kg: p["4"].kg }, next: "fim" },
      { id: "maior", kind: "text", text: CFG.maiorTexto, labels: CFG.labels,
        pedirHumano: true, handoffContexto: { area_hectares: ">4" }, next: "fim" },
      { id: "fim", kind: "end" },
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

// ─────────────────────── multi-disparador (5 senders) ───────────────────────
async function getMedia(db) {
  const media = await db.scan("funnel_media", "slot,url,active",
    `funnel=eq.${CFG.funnel}&active=eq.true&slot=in.(${CFG.videoSlot},${CFG.headerSlot})`);
  const video = media.find((m) => m.slot === CFG.videoSlot && m.url);
  const header = media.find((m) => m.slot === CFG.headerSlot && m.url);
  if (!video) fail(`slot de vídeo ${CFG.videoSlot} ausente/inativo`);
  if (!header) fail(`slot de imagem ${CFG.headerSlot} ausente/inativo`);
  return { videoUrl: String(video.url), headerUrl: String(header.url) };
}

async function templateStatusFor(env, wabaId) {
  const metaToken = env.META_ACCESS_TOKEN;
  if (!metaToken || !wabaId) return "SEM WABA/TOKEN";
  const graph = env.META_GRAPH_VERSION || "v21.0";
  const r = await fetch(`https://graph.facebook.com/${graph}/${wabaId}/message_templates?limit=200&fields=name,status,language`,
    { headers: { Authorization: `Bearer ${metaToken}` } });
  if (!r.ok) return `erro Graph ${r.status}`;
  const d = await r.json();
  const t = (d.data || []).find((x) => x.name === CFG.templateName);
  return t ? `${t.status} (${t.language})` : "NÃO EXISTE";
}

// Canal por NOME exato. Oficial (template) exige phone_number_id+waba; uazapi (botões) não.
async function discoverChannel(db, env, name, opener) {
  const canais = await db.scan("channels", "id,name,phone_number,phone_number_id,waba_id,status,type");
  const canal = canais.find((c) => String(c.name) === name && String(c.type).toLowerCase() === "whatsapp");
  if (!canal) fail(`canal ${name} não encontrado`);
  let templateStatus = "n/a (uazapi)";
  if (opener === "template") {
    if (!canal.phone_number_id) fail(`canal ${name} sem phone_number_id (precisa oficial)`);
    templateStatus = await templateStatusFor(env, canal.waba_id);
  }
  return { canal, templateStatus };
}

function buildCampaignFor(id, name, flow) {
  return { id, name, template: "(fluxo)", language: CFG.templateLanguage, steps: [], flow,
    pace: { ...CFG.pace }, delayMin: 0, delayMax: 0, createdAt: new Date().toISOString() };
}

// Fatia a lista: oficiais pegam as cotas fixas do topo (melhores regiões); os uazapi dividem o resto.
function splitEntreSenders(phones) {
  const slices = {}; let idx = 0;
  for (const s of SENDERS.filter((x) => x.fixo)) { slices[s.key] = phones.slice(idx, idx + s.fixo); idx += s.fixo; }
  const resto = phones.slice(idx);
  const uz = SENDERS.filter((x) => !x.fixo);
  const per = Math.ceil(resto.length / Math.max(1, uz.length));
  uz.forEach((s, i) => { slices[s.key] = resto.slice(i * per, (i + 1) * per); });
  return slices;
}

async function multi(db, env, apply, argv) {
  const { phones } = await deriveTargets(db);
  const { videoUrl, headerUrl } = await getMedia(db);
  const slices = splitEntreSenders(phones);

  console.log("=== Multi-disparador (dry-run" + (apply ? "/APPLY" : "") + ") ===");
  console.log("ritmo por campanha:", JSON.stringify(CFG.pace), "\n");

  const planos = [];
  for (const s of SENDERS) {
    const { canal, templateStatus } = await discoverChannel(db, env, s.channelName, s.opener);
    const fatia = slices[s.key] || [];
    const pronto = s.opener === "buttons" || /^APPROVED/.test(templateStatus);
    planos.push({ s, canal, templateStatus, fatia, pronto });
    console.log(`${s.key.padEnd(20)} canal=${s.channelName} abridor=${s.opener.padEnd(8)} fatia=${String(fatia.length).padStart(5)} template=${templateStatus} -> ${pronto ? "PRONTO" : "SEGURADO"}`);
  }
  const total = planos.reduce((a, p) => a + p.fatia.length, 0);
  console.log("\nTOTAL distribuído:", total, "de", phones.length, "(sobra", phones.length - total, ")");

  if (!apply) { console.log("\n(dry-run) nada gravado. --multi --apply cria/enfileira as campanhas PRONTAS."); return; }

  const state = (await db.storageDownloadJson(CAMPAIGNS_FILE)) ?? { campaigns: [], targets: {} };
  if (!Array.isArray(state.campaigns)) state.campaigns = [];
  for (const p of planos) {
    if (!p.pronto) { console.log(`• ${p.s.key}: PULADO (template ${p.templateStatus})`); continue; }
    if (!p.fatia.length) { console.log(`• ${p.s.key}: sem contatos`); continue; }
    const flow = buildFlow(p.s.opener, videoUrl, headerUrl);
    if (!state.campaigns.some((c) => c?.id === p.s.key)) {
      state.campaigns.push(buildCampaignFor(p.s.key, `Reativação ${p.s.channelName} ${p.s.opener}`, flow));
      await db.storageUploadJson(CAMPAIGNS_FILE, state);
    }
    const rows = p.fatia.map((contact_key) => ({ campaign_id: p.s.key, contact_key, channel_id: p.canal.id, status: "pending" }));
    for (let i = 0; i < rows.length; i += QUEUE_BATCH) await db.enqueue(rows.slice(i, i + QUEUE_BATCH));
    const check = await db.scan("campaign_queue", "status", `campaign_id=eq.${encodeURIComponent(p.s.key)}`);
    console.log(`• ${p.s.key}: enfileirados ${p.fatia.length} | pending ${check.filter((r) => r.status === "pending").length}`);
  }
  console.log("\nDisparo começa no próximo tick (1min), dentro de 8–18h BRT, 25/dia subindo +5 (teto 100) por campanha.");
}

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const ti = argv.indexOf("--test");
  const testPhone = ti >= 0 ? argv[ti + 1] : null; // --test <fone>: enfileira só esse número
  const env = await loadEnv();
  const db = rest(env);

  if (argv.includes("--multi")) return multi(db, env, apply, argv);

  const { phones, resumo } = await deriveTargets(db);
  const found = await discover(db, env);
  const flow = buildFlow("template", found.videoUrl, found.headerUrl);
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

  // alvo: --test enfileira só o número informado; --apply enfileira a lista toda.
  const alvo = testPhone ? [toE164(testPhone)].filter((p) => p.length >= 12) : phones;

  if (!apply && !testPhone) {
    console.log(`\n(dry-run) nada foi gravado. --test <fone> enfileira 1 número; --apply enfileira os ${phones.length}.`);
    return;
  }

  // writes exigem template APPROVED
  if (!/^APPROVED/.test(found.templateStatus)) {
    fail(`recusado: template "${CFG.templateName}" não está APPROVED (está: ${found.templateStatus}). Crie/aprove no Meta Business Manager primeiro.`);
  }
  if (!alvo.length) fail("recusado: nenhum número válido pra enfileirar");

  // Garante a campanha em campaigns.json — cria se faltar, reaproveita se já existe. Assim
  // --test e --apply compõem: o teste cria a campanha com 1 número, o apply depois só adiciona
  // o resto (o enqueue é upsert ignore-duplicates, ninguém entra duas vezes).
  const state = (await db.storageDownloadJson(CAMPAIGNS_FILE)) ?? { campaigns: [], targets: {} };
  if (!Array.isArray(state.campaigns)) state.campaigns = [];
  if (!state.campaigns.some((c) => c?.id === campaign.id)) {
    state.campaigns.push(campaign);
    await db.storageUploadJson(CAMPAIGNS_FILE, state);
    console.log("campanha criada em campaigns.json");
  } else {
    console.log("campanha já existe em campaigns.json — reaproveitando");
  }

  const rows = alvo.map((contact_key) => ({
    campaign_id: campaign.id, contact_key, channel_id: found.canal.id, status: "pending",
  }));
  for (let i = 0; i < rows.length; i += QUEUE_BATCH) await db.enqueue(rows.slice(i, i + QUEUE_BATCH));

  const check = await db.scan("campaign_queue", "status", `campaign_id=eq.${encodeURIComponent(campaign.id)}`);
  const pend = check.filter((r) => r.status === "pending").length;
  console.log(`\n${testPhone ? "(test)" : "(apply)"} enfileirados ${alvo.length} número(s). Total pending na fila: ${pend}.`);
  console.log("O disparo começa no próximo tick do loop (1min), dentro de 8–20h BRT.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`prepare-reativacao-campaign: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}

export { buildFlow, buildCampaign, deriveTargets, CFG };
