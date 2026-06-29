// funil-enroll — coloca um lead no funil de apresentação Mega Sorgo: gera a fila
// (scheduled_messages) com os 5 acessos, sorteando mídia da "faixa" (funnel_media) pra variar.
// Textos e botões são fixos (roteiro v2 — docs/funil-mega-sorgo-playbook.md). Imagem/áudios/
// vídeo vêm da faixa (rotação por slot). Slot sem mídia cadastrada -> peça é pulada (não trava).
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";

type Json = Record<string, unknown>;
const FUNNEL = "mega-sorgo";
// ESTRATÉGIA JANELA: número oficial tem janela de 24h (conta da última msg do cliente). Se
// esperar resposta em dias, perde a janela e o lead. Então TODO o conteúdo vai num dia só.
// 5 acessos; o intervalo conta a partir do ÚLTIMO disparo do acesso anterior (vídeo/lista, ~+10min):
// +30min, +2h, +4h, +8h. Cada disparo respeita HORÁRIO COMERCIAL 6h-22h (BRT): o que cairia de
// madrugada para e retoma às 6h, contando dali. Tudo fica abaixo de 24h (cabe na janela).
const GAPS = [0, 1_800, 7_200, 14_400, 28_800]; // gap antes de cada acesso (s): -, 30min, 2h, 4h, 8h
// Peças DENTRO de um acesso ficam sempre >=70s uma da outra. O cron do n8n roda 1x/min e
// dispara junto tudo que já venceu -- gap < 60s não garante ordem de chegada (2 peças no
// mesmo tick podem sair em ordem trocada). >=70s garante 1 peça por tick.
const FIM_ACESSO = 520;                          // último disparo do acesso (lista de fechamento) = +8min40
const TZ_OFFSET = 3 * 3600 * 1000;               // BRT = UTC-3

// Empurra um horário pro próximo 6h se ele (ou o acesso inteiro de `durSec`) cair fora de 6h-22h BRT.
function clampBiz(ms: number, durSec = 0): number {
  const brt = new Date(ms - TZ_OFFSET);
  const startMin = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  const endMin = startMin + durSec / 60;
  const OPEN = 6 * 60, CLOSE = 22 * 60;
  if (startMin >= OPEN && endMin <= CLOSE) return ms;
  const t = new Date(brt);
  if (startMin >= CLOSE || endMin > CLOSE) t.setUTCDate(t.getUTCDate() + 1); // noite -> 6h do dia seguinte
  t.setUTCHours(6, 0, 0, 0); // madrugada -> 6h do mesmo dia
  return t.getTime() + TZ_OFFSET;
}

type Botao = { id: string; title: string };
type Peca =
  | { offset: number; kind: "text"; text: string }
  | { offset: number; kind: "text_sequence"; texts: string[] }
  | { offset: number; kind: "interactive"; text: string; buttons: Botao[]; headerSlot?: string }
  | { offset: number; kind: "media"; mediaType: "image" | "audio" | "video"; slot: string; caption?: string }
  | { offset: number; kind: "list"; text: string; buttonLabel: string; sections: { title?: string; rows: Botao[] }[] };

// Menu de ação — disponível no fechamento de TODA fase. Clique entrega o conteúdo na hora
// (lógica em hub-webhook.ts: handleMenuClick), sem precisar esperar a fase certa.
const MENU_ROWS: Botao[] = [
  { id: "menu_preco", title: "💰 Preço" },
  { id: "menu_plantio", title: "🌱 Como plantar" },
  { id: "menu_nutricao", title: "🧪 Info nutricional" },
  { id: "menu_depoimento", title: "🎬 Quem já plantou" },
  { id: "menu_humano", title: "🧑‍🌾 Falar com Cícero" },
];

function closingList(gancho: { text: string; row: Botao } | null): Peca {
  const sections = gancho
    ? [{ title: "Continuar", rows: [gancho.row] }, { title: "Tire sua dúvida", rows: MENU_ROWS }]
    : [{ title: "Tire sua dúvida", rows: MENU_ROWS }];
  return { offset: 0, kind: "list", text: gancho?.text ?? "O senhor quer saber mais sobre o quê? 🙌", buttonLabel: "Ver opções", sections };
}

// roteiro de cada fase. offset = segundos DENTRO do acesso (relativo ao início dele).
function fase1(): Peca[] {
  return [
    { offset: 0, kind: "text", text: "Olá, amigo! Tudo bem? 😊👋\n\nAqui é o *Cícero Sobreira* 👨‍🌾" },
    // logo é FIXA (slot "logo" só tem 1 mídia cadastrada — não rotaciona).
    { offset: 70, kind: "media", mediaType: "image", slot: "logo",
      caption: "Somos da *Campo Soberano* 🌾\n\nEspecialistas nas sementes do *Mega Sorgo Santa Elisa* 🚜" },
    { offset: 140, kind: "interactive", text: "O senhor se interessou no *Mega Sorgo Santa Elisa*?",
      buttons: [{ id: "f1_sim", title: "Quero saber mais ✅" }, { id: "f1_olhando", title: "Só olhando 👀" }],
      headerSlot: "image" },
    { offset: 210, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 280, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 350, kind: "media", mediaType: "image", slot: "image" },
    { offset: 420, kind: "media", mediaType: "video", slot: "video" },
    { ...closingList({ text: "O senhor sabe *quanto ele produz por hectare*? 🤔📊", row: { id: "f1_continuar", title: "📈 Quanto produz?" } }) as Peca, offset: 490 },
  ];
}

// Ordem padrão (combinada 29/06, corrigida 29/06 2): imagem e botão são UMA mensagem só
// (header_image no interactive) -> áudio1 -> áudio2 -> vídeo -> lista de fechamento (sempre
// por último). Nunca manda imagem solta separada do botão de abertura.
function fase2(): Peca[] {
  return [
    { offset: 0, kind: "interactive",
      text: "O *Mega Sorgo Santa Elisa* tem marcas que *poucos produtos no Brasil* alcançam 🇧🇷\n\n📈 Mais de *140 toneladas de silagem por hectare ao ano*\n🌾 Porque passa de *5 metros de altura*!\n\nO senhor trabalha com gado de leite ou de corte? 🐄",
      buttons: [{ id: "f2_leite", title: "Leite 🥛" }, { id: "f2_corte", title: "Corte 🥩" }, { id: "f2_ambos", title: "Os dois 🐄" }],
      headerSlot: "image" },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 210, kind: "media", mediaType: "video", slot: "video" },
    { ...closingList({ text: "Quer saber por que ele é *melhor que o milho*? 🤫🌽", row: { id: "f2_continuar", title: "🌽 Quero o segredo" } }) as Peca, offset: 280 },
  ];
}

function fase3(): Peca[] {
  return [
    { offset: 0, kind: "interactive",
      text: "O segredo? 🤫\n\n🌽 Ele *REBROTA* — corta e nasce de novo, diferente do milho!\n\nHoje o senhor planta o quê pra silagem?",
      buttons: [{ id: "f3_milho", title: "Milho 🌽" }, { id: "f3_capim", title: "Capim 🌿" }, { id: "f3_nao", title: "Não planto 🤷" }],
      headerSlot: "image" },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 210, kind: "media", mediaType: "video", slot: "video" },
    { ...closingList({ text: "E quando vem a *praga* e a *seca*? Quer ver como ele segura firme? 💪", row: { id: "f3_continuar", title: "💪 Quero ver" } }) as Peca, offset: 280 },
  ];
}

function fase4(): Peca[] {
  return [
    { offset: 0, kind: "text_sequence", texts: [
      "🐛 *Resistente às pragas!*\n\nLagarta e cigarrinha não derrubam o Mega Sorgo.",
      "☀️ *Aguenta a seca!*\n\nGarante a sua silagem mesmo no ano mais difícil.",
    ] },
    { offset: 70, kind: "interactive", text: "O senhor já perdeu lavoura pra praga ou seca? 😟",
      buttons: [{ id: "f4_ja", title: "Já sim 😔" }, { id: "f4_nunca", title: "Nunca, graças 🙏" }],
      headerSlot: "image" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 210, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 280, kind: "media", mediaType: "image", slot: "image", caption: "🌾 *Lavoura forte* mesmo no ano mais difícil!" },
    { offset: 350, kind: "media", mediaType: "video", slot: "video" },
    { ...closingList({ text: "Quer *garantir o seu* pra safra 2027? 🚜", row: { id: "f4_continuar", title: "🚜 Quero garantir" } }) as Peca, offset: 420 },
  ];
}

// Fase 5: sem gancho (é a última) — fechamento é só o menu de dúvidas.
function fase5(): Peca[] {
  return [
    { offset: 0, kind: "interactive",
      text: "🌾 Estamos com uma *condição especial* no lote dessa safra!\n\n⚠️ Mas o lote é *limitado* e tá saindo rápido 🏃\n\nPosso te passar a *condição especial*? 💰",
      buttons: [{ id: "f5_sim", title: "Sim, quero 💰" }],
      headerSlot: "image" },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 210, kind: "media", mediaType: "video", slot: "video" },
    { ...closingList(null) as Peca, offset: 280 },
  ];
}

const FASES: (() => Peca[])[] = [fase1, fase2, fase3, fase4, fase5];

// calcula o timestamp de início (ms) de cada acesso: encadeia GAPS a partir do fim (lista de
// fechamento) do acesso anterior e aplica horário comercial. Garante que o acesso cabe inteiro.
function iniciosDosAcessos(agora: number): number[] {
  const inicios: number[] = [];
  let fimAnterior = clampBiz(agora, FIM_ACESSO);
  for (let i = 0; i < GAPS.length; i++) {
    const ini = i === 0 ? fimAnterior : clampBiz(fimAnterior + GAPS[i] * 1000, FIM_ACESSO);
    inicios.push(ini);
    fimAnterior = ini + FIM_ACESSO * 1000;
  }
  return inicios;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET"))) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => ({})) as Json;
  const cwConvId = Number(body.chatwoot_conversation_id);
  if (!cwConvId) return json({ error: "chatwoot_conversation_id obrigatório" }, 400);

  const db = admin();
  const { data: conv } = await db.from("conversations").select("id, chatwoot_conversation_id")
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (!conv) return json({ error: "conversa não encontrada" }, 404);

  // dedup: já está no funil?
  const { data: existing } = await db.from("sales_sequences").select("id")
    .eq("conversation_id", conv.id).eq("funnel", FUNNEL).maybeSingle();
  if (existing) return json({ ok: true, already: true });

  // carrega a faixa e agrupa por dia+slot pra sortear
  const { data: media } = await db.from("funnel_media").select("day,slot,url,caption,type")
    .eq("funnel", FUNNEL).eq("active", true);
  const banco = new Map<string, Json[]>();
  for (const m of (media ?? []) as Json[]) {
    const k = `${m.day}:${m.slot}`;
    (banco.get(k) ?? banco.set(k, []).get(k)!).push(m);
  }
  const pick = (dia: number, slot: string): Json | null => {
    const arr = banco.get(`${dia}:${slot}`);
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  };

  const agora = Date.now();
  const inicios = iniciosDosAcessos(agora);
  const rows: Json[] = [];
  for (let i = 0; i < FASES.length; i++) {
    const dia = i + 1;
    for (const p of FASES[i]()) {
      const sendAt = new Date(inicios[dia - 1] + p.offset * 1000).toISOString();
      if (p.kind === "text") {
        rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: "text", payload: { content: p.text }, send_at: sendAt });
      } else if (p.kind === "text_sequence") {
        rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: "text_sequence", payload: { texts: p.texts }, send_at: sendAt });
      } else if (p.kind === "interactive") {
        const header = p.headerSlot ? pick(dia, p.headerSlot) : null;
        const payload: Json = { text: p.text, buttons: p.buttons };
        if (header?.url) payload.header_image = header.url;
        rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: "interactive", payload, send_at: sendAt });
      } else if (p.kind === "list") {
        const payload: Json = { text: p.text, button_label: p.buttonLabel, sections: p.sections };
        rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: "list", payload, send_at: sendAt });
      } else {
        const m = pick(dia, p.slot);
        if (!m?.url) continue; // sem mídia cadastrada nesse slot -> pula
        const payload: Json = { media_url: m.url };
        const cap = (p.caption ?? "") || (m.caption as string ?? "");
        if (cap && p.mediaType !== "audio") payload.caption = cap;
        rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: p.mediaType, payload, send_at: sendAt });
      }
    }
  }

  await db.from("sales_sequences").insert({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, status: "running" });
  const { error } = await db.from("scheduled_messages").insert(rows);
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true, enfileiradas: rows.length });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
