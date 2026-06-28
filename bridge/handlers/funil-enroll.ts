// funil-enroll — coloca um lead no funil de apresentação Mega Sorgo: gera a fila
// (scheduled_messages) com os 4 dias, sorteando mídia da "faixa" (funnel_media) pra variar.
// Textos e botões são fixos (roteiro); imagem/áudios/vídeo vêm da faixa (rotação por slot).
// Se um slot de mídia não tiver nada cadastrado, a peça é pulada (não trava o funil).
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { admin } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";

type Json = Record<string, unknown>;
const FUNNEL = "mega-sorgo";
// Espaçamento entre os 4 blocos. 6h => funil inteiro cabe em ~18-20h, DENTRO da janela de 24h
// do WhatsApp oficial (que conta da última msg do cliente). Assim nunca quebra a janela mesmo
// ESTRATÉGIA JANELA: número oficial tem janela de 24h (conta da última msg do cliente). Se
// esperar resposta em dias, perde a janela e o lead. Então TODO o conteúdo vai num dia só.
// 5 acessos; o intervalo conta a partir do ÚLTIMO disparo do acesso anterior (o vídeo, +10min):
// +30min, +2h, +4h, +8h. Cada disparo respeita HORÁRIO COMERCIAL 6h-22h (BRT): o que cairia de
// madrugada para e retoma às 6h, contando dali. Tudo fica abaixo de 24h (cabe na janela).
const GAPS = [0, 1_800, 7_200, 14_400, 28_800]; // gap antes de cada acesso (s): -, 30min, 2h, 4h, 8h
const FIM_ACESSO = 600;                          // último disparo do acesso (vídeo) = +10min
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

type Peca =
  | { day: number; offset: number; kind: "text"; text: string }
  | { day: number; offset: number; kind: "interactive"; text: string; buttons: { id: string; title: string }[]; headerSlot?: string }
  | { day: number; offset: number; kind: "media"; mediaType: "image" | "audio" | "video"; slot: string; caption?: string };

// conteúdo de cada acesso (texto, legenda da imagem, pergunta+botões)
const CONTEUDO: { text: string; imgCaption: string; pergunta: string; buttons: { id: string; title: string }[]; headerImg?: boolean }[] = [
  { text: "Olá, tudo bem? 😊👋\n\nAqui é o *Cícero Sobreira* 👨‍🌾\n\nO senhor se interessou nas sementes do *Mega Sorgo Santa Elisa*?",
    imgCaption: "Sou representante da *Campo Soberano* 🌾🚜\n\nEspecialistas no *Mega Sorgo Santa Elisa* 🔥",
    pergunta: "O senhor já conhece o *Mega Sorgo Santa Elisa*?\n\nJá viu a alta produção dele? 🤔📈",
    buttons: [ { id: "conhece_sim", title: "Já conheço ✅" }, { id: "conhece_nao", title: "Não conheço 🤔" }, { id: "tem_duvida", title: "Tenho dúvida ❓" } ], headerImg: true },
  { text: "Olha que beleza! 🌱🔥\n\n🌾 Passa de *5 METROS* de altura!\n📈 Mais de *140 TONELADAS* por hectare!",
    imgCaption: "🌾 *Mega Sorgo Santa Elisa* — Safra 2027 🏆",
    pergunta: "O senhor trabalha com gado de leite ou de corte? 🐄",
    buttons: [ { id: "gado_leite", title: "Leite 🥛" }, { id: "gado_corte", title: "Corte 🥩" }, { id: "gado_ambos", title: "Os dois 🐄" } ] },
  { text: "Quer saber o segredo dele? 🤫\n\n🌽 Ele *REBROTA*! Rende mais que o milho\n🔥 E é *80% superior* ao Capiaçu na silagem!",
    imgCaption: "Silagem de *alta qualidade* — seu gado come melhor 🐄",
    pergunta: "Quer ver o vídeo da lavoura de perto? 🎬",
    buttons: [ { id: "ver_video", title: "Sim, quero ver ▶️" } ] },
  { text: "💪 Resistente a *praga* (lagarta, cigarrinha)\n☀️ E aguenta bem a *seca*!\n\nMenos dor de cabeça pra você! 🙌",
    imgCaption: "🏆 Quem entende de resultado planta *Mega Sorgo Santa Elisa*!",
    pergunta: "O senhor quer saber o preço? 💰",
    buttons: [ { id: "quer_preco", title: "Quero o preço 💰" }, { id: "falar_vendedor", title: "Falar c/ vendedor 👨‍🌾" } ] },
  { text: "🚨 *Última chamada!* 🌾\n\nA *Safra 2027* tá fechando os pedidos do *Mega Sorgo Santa Elisa*.\n\nNão fique de fora de quem vai ter a melhor silagem! 🚜",
    imgCaption: "🏆 *Mega Sorgo Santa Elisa* — Garanta o seu! 🌾",
    pergunta: "Vamos garantir as suas sementes? 🙌",
    buttons: [ { id: "garantir", title: "Quero garantir 🚜" }, { id: "falar_agora", title: "Falar agora 📞" } ] },
];

// offset = segundos DENTRO do acesso (relativo ao início dele). o handle calcula o início
// real de cada acesso encadeando os GAPS + horário comercial.
function roteiro(): Peca[] {
  const pecas: Peca[] = [];
  for (let i = 0; i < CONTEUDO.length; i++) {
    const day = i + 1;
    const c = CONTEUDO[i];
    pecas.push({ day, offset: 0, kind: "text", text: c.text });
    pecas.push({ day, offset: 40, kind: "media", mediaType: "image", slot: "image", caption: c.imgCaption });
    pecas.push({ day, offset: 80, kind: "interactive", text: c.pergunta, buttons: c.buttons, ...(c.headerImg ? { headerSlot: "image" } : {}) });
    pecas.push({ day, offset: 300, kind: "media", mediaType: "audio", slot: "audio1" });
    pecas.push({ day, offset: 330, kind: "media", mediaType: "audio", slot: "audio2" });
    pecas.push({ day, offset: 600, kind: "media", mediaType: "video", slot: "video", caption: "" });
  }
  return pecas;
}

// calcula o timestamp de início (ms) de cada acesso: encadeia GAPS a partir do fim (vídeo) do
// acesso anterior e aplica horário comercial. Garante que o acesso inteiro (até o vídeo) cabe.
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
  for (const p of roteiro()) {
    const dia = p.day;
    const sendAt = new Date(inicios[dia - 1] + p.offset * 1000).toISOString();
    if (p.kind === "text") {
      rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: "text", payload: { content: p.text }, send_at: sendAt });
    } else if (p.kind === "interactive") {
      const header = p.headerSlot ? pick(dia, p.headerSlot) : null;
      const payload: Json = { text: p.text, buttons: p.buttons };
      if (header?.url) payload.header_image = header.url;
      rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: "interactive", payload, send_at: sendAt });
    } else {
      const m = pick(dia, p.slot);
      if (!m?.url) continue; // sem mídia cadastrada nesse slot -> pula
      const payload: Json = { media_url: m.url };
      const cap = (p.caption ?? "") || (m.caption as string ?? "");
      if (cap && p.mediaType !== "audio") payload.caption = cap;
      rows.push({ conversation_id: conv.id, chatwoot_conversation_id: cwConvId, funnel: FUNNEL, day: dia, step: rows.length, type: p.mediaType, payload, send_at: sendAt });
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
