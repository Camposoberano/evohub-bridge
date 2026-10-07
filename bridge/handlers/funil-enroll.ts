// funil-enroll — coloca um lead no funil de apresentação Mega Sorgo: gera a fila
// (scheduled_messages) com os 5 acessos, sorteando mídia da "faixa" (funnel_media) pra variar.
// Textos e botões são fixos (roteiro v2 — docs/funil-mega-sorgo-playbook.md). Imagem/áudios/
// vídeo vêm da faixa (rotação por slot). Slot sem mídia cadastrada -> peça é pulada (não trava).
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { consultaEmLotes } from "../shared/lotes.ts";
import { admin, claimDeliveryWithTtl, releaseDelivery } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import {
  foldText,
  isDefaultAdMessage,
  pareceAberturaComercial,
} from "../shared/ad-lead.ts";
import {
  addBusinessSeconds,
  clampBusinessTime,
} from "../shared/business-time.ts";
import {
  isContactBlocked,
  isContactExcludedFromAutomation,
} from "../shared/lead-block.ts";
import { type Isca, iscasAtivas } from "../shared/iscas.ts";
import { classificarIntencaoComercial } from "../shared/funil-comercial.ts";

type Json = Record<string, unknown>;
const FUNNEL = "mega-sorgo";
// Jornada estendida: os intervalos contam apenas dentro de 06h-22h BRT e começam no fim
// da fase anterior. Às 22h o relógio congela; às 06h ele continua com o saldo restante.
// A retomada final (+10h úteis depois da fase 5) é criada por funnel-recovery.ts.
const GAPS = [0, 1_800, 21_600, 43_200, 43_200]; // imediato, +30min, +6h, +12h, +12h
// modo TESTE (body.fast=true): fases fluem em sequência (~70s entre fases, sem horário comercial),
// pra revisar o funil todo em ~30min sem clicar. Produção usa a jornada comercial de até 48h.
const GAPS_FAST = [0, 70, 70, 70, 70];
// Peças DENTRO de um acesso ficam sempre >=70s uma da outra. O cron do n8n roda 1x/min e
// dispara junto tudo que já venceu -- gap < 60s não garante ordem de chegada (2 peças no
// mesmo tick podem sair em ordem trocada). >=70s garante 1 peça por tick.
// Teto do acesso: a próxima fase começa em ini+FIM_ACESSO, então peça agendada além disso
// invade a fase seguinte. Exportado pra tests/funil-offsets.test.ts vigiar.
export const FIM_ACESSO = 560; // último disparo do acesso (lista de fechamento) = +9min20
// (a fase 5 ganhou a oferta de isca no offset 490, empurrando o fechamento de 490 p/ 560)
const TZ_OFFSET = 3 * 3600 * 1000; // BRT = UTC-3

type Botao = { id: string; title: string };
type Peca =
  | { offset: number; kind: "text"; text: string; opening?: boolean }
  | { offset: number; kind: "text_sequence"; texts: string[] }
  | {
    offset: number;
    kind: "interactive";
    text: string;
    buttons: Botao[];
    headerSlot?: string;
    mediaDay?: number;
  }
  | {
    offset: number;
    kind: "media";
    mediaType: "image" | "audio" | "video";
    slot: string;
    caption?: string;
    // Por padrão a peça sorteia mídia do dia da própria fase (dia 1 = fase 1...). mediaDay
    // aponta pra outro dia da faixa -- o dia 0 é o catálogo de artes fixas (preço, logística,
    // plantio), que não pertence a fase nenhuma e é reaproveitado por várias.
    mediaDay?: number;
  }
  | {
    offset: number;
    kind: "list";
    text: string;
    buttonLabel: string;
    sections: { title?: string; rows: Botao[] }[];
    opening?: boolean;
  };

// Menu de ação — disponível no fechamento de TODA fase. Clique entrega o conteúdo na hora
// (lógica em hub-webhook.ts: handleMenuClick), sem precisar esperar a fase certa.
const MENU_ROWS: Botao[] = [
  { id: "menu_preco", title: "💰 Preço" },
  { id: "menu_plantio", title: "🌱 Como plantar" },
  { id: "menu_nutricao", title: "🧪 Info nutricional" },
  { id: "menu_depoimento", title: "🎬 Assistir vídeos" },
  { id: "menu_humano", title: "🧑‍🌾 Falar com Cícero" },
];

function closingList(): Peca {
  return {
    offset: 0,
    kind: "list",
    text: "O senhor quer saber mais sobre o quê? 🙌",
    buttonLabel: "Ver opções",
    sections: [{ title: "Tire sua dúvida", rows: MENU_ROWS }],
  };
}

// Oferta de isca digital: imagem (capa do material) + pergunta + botões Sim/Não. O PDF só é
// enviado quando o cliente toca "Sim" (handleMenuClick -> handleIscaSequence). Vem ANTES do
// fechamento porque a última peça da fase precisa ser a lista que pede o CEP.
function ofertaIsca(isca: Isca, offset: number): Peca {
  return {
    offset,
    kind: "interactive",
    text: isca.pergunta,
    headerSlot: isca.capaSlot,
    mediaDay: 0,
    buttons: [
      { id: isca.botaoSim, title: isca.tituloSim },
      { id: isca.botaoNao, title: isca.tituloNao },
    ],
  };
}

function turnoBRT(now = Date.now()): string {
  const h = ((now - TZ_OFFSET) % 86_400_000) / 3_600_000 | 0;
  return h < 12 ? "bom dia" : h < 18 ? "boa tarde" : "boa noite";
}

export function saudacaoDinamica(now = Date.now()): string {
  const aberturas = ["Olá", "Oi", "E aí"];
  const finais = [
    "tudo bem?",
    "que bom ter você aqui!",
    "como vai?",
    "tudo certo?",
  ];
  const i = now % aberturas.length;
  // Bitwise converte Date.now() para inteiro assinado de 32 bits e pode gerar
  // indice negativo. Divisao normal preserva um indice valido ao longo do tempo.
  const j = Math.floor(now / 16) % finais.length;
  const turno = turnoBRT(now);
  return `${aberturas[i]}, ${turno}, vida boa! ${
    finais[j]
  } 😊👋\n\nAqui é o *Cícero Sobreira*, da *Campo Soberano* 👨‍🌾🌾`;
}

// roteiro de cada fase. offset = segundos DENTRO do acesso (relativo ao início dele).
function fase1(): Peca[] {
  return [
    { offset: 0, kind: "text", text: saudacaoDinamica() },
    {
      offset: 70,
      kind: "media",
      mediaType: "image",
      slot: "logo",
      caption:
        "Somos da *Campo Soberano* 🌾\n\nEspecialistas nas sementes do *Mega Sorgo Santa Elisa* 🚜",
    },
    {
      offset: 140,
      kind: "media",
      mediaType: "image",
      slot: "image",
      caption:
        "Este é o Mega Sorgo Santa Elisa. Ao final desta etapa, escolha no menu se quer ver preço, plantio, informação nutricional, vídeos ou falar com o Cícero.",
    },
    { offset: 210, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 280, kind: "media", mediaType: "audio", slot: "audio2" },
    // A imagem de apresentação segue como peça própria; perguntas com botões sem destino
    // foram retiradas até existir tratamento de respostas para esta jornada agendada.
    { offset: 350, kind: "media", mediaType: "video", slot: "video" },
    {
      ...closingList(),
      offset: 420,
    },
  ];
}

// Fase 2: imagem com legenda -> áudios -> vídeo -> menu final com ações que têm handler.
function fase2(): Peca[] {
  return [
    {
      offset: 0,
      kind: "media",
      mediaType: "image",
      slot: "image",
      caption:
        "O sorgo forrageiro pode ser uma alternativa para silagem. Produção e qualidade variam conforme o híbrido, a região, a época e o manejo; compare a ficha técnica e os resultados de campo antes de estimar sua área.",
    },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 210, kind: "media", mediaType: "video", slot: "video" },
    {
      ...closingList(),
      offset: 280,
    },
  ];
}

function fase3(): Peca[] {
  return [
    {
      offset: 0,
      kind: "media",
      mediaType: "image",
      slot: "image",
      caption:
        "Alguns materiais de sorgo podem rebrotar após o corte. O volume e a qualidade do segundo corte variam conforme o híbrido, a chuva e o manejo; não são duas colheitas garantidas iguais.",
    },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    { offset: 210, kind: "media", mediaType: "video", slot: "video" },
    {
      ...closingList(),
      offset: 280,
    },
  ];
}

function fase4(): Peca[] {
  return [
    {
      offset: 0,
      kind: "media",
      mediaType: "image",
      slot: "image",
      caption:
        "O sorgo pode ter vantagem em condições de menor disponibilidade de água, mas seca e pragas ainda podem afetar a lavoura. O resultado depende do híbrido, da região e do manejo.",
    },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    {
      offset: 210,
      kind: "media",
      mediaType: "image",
      slot: "image",
      caption: "🌾 *Lavoura forte* mesmo no ano mais difícil!",
    },
    { offset: 280, kind: "media", mediaType: "video", slot: "video" },
    {
      ...closingList(),
      offset: 350,
    },
  ];
}

// Fase 5 — oferta + LOGÍSTICA + cotação sem preço automático.
// Endereço/CEP enviados livremente são detectados por isFechamentoIntent (shared/intent.ts),
// que pausa o funil e encaminha para atendimento.
function fase5(): Peca[] {
  return [
    {
      offset: 0,
      kind: "text",
      text:
        "Se quiser consultar os pacotes e a condição vigente, use a opção *Preço* no menu ao final. A disponibilidade é confirmada antes de fechar o pedido.",
    },
    { offset: 70, kind: "media", mediaType: "audio", slot: "audio1" },
    { offset: 140, kind: "media", mediaType: "audio", slot: "audio2" },
    {
      offset: 210,
      kind: "text_sequence",
      texts: [
        "🏢 *Nossos depósitos:*\n\n1️⃣ Campinas – SP\n2️⃣ Lucas do Rio Verde – MT\n3️⃣ Toledo – PR\n4️⃣ Fortaleza – CE\n5️⃣ Juazeiro do Norte – CE",
        "🌱 *Disponibilidade por localidade:*\n\n🔹 *Mega Sorgo Santa Elisa*® — exclusivo no depósito de *Campinas – SP*\n🔹 *BRS 661* e *BRS Ponta Negra* (Embrapa) — *Fortaleza – CE* e *Toledo – PR*",
        "📦 Todo pedido sai com *nota fiscal*, *rastreamento* e *frete grátis* pra qualquer região do Brasil 🇧🇷",
      ],
    },
    // A arte da logística fecha a objeção do "compra pela internet": mostra a entrega,
    // não só descreve. Vem do catálogo (dia 0), por isso mediaDay.
    {
      offset: 280,
      kind: "media",
      mediaType: "image",
      slot: "logistica_img",
      mediaDay: 0,
    },
    { offset: 350, kind: "media", mediaType: "video", slot: "video" },
    {
      offset: 420,
      kind: "text",
      text:
        "🚚 O frete é grátis e o desconto é progressivo por quantidade: pode chegar a 30% em pedidos acima de 100 kg.\n\n📦 O valor exato depende do volume. Toque em *Preço* no menu e diga a quantidade ou a área que pretende plantar para receber a cotação.",
    },
    // Oferta da isca (imagem + Sim/Não). Antes do fechamento porque a última peça precisa
    // ser a lista que pede o CEP. Sem isca cadastrada, some e o fechamento volta pra 490.
    ...(iscasAtivas().length ? [ofertaIsca(iscasAtivas()[0], 490)] : []),
    {
      ...closingList(),
      offset: iscasAtivas().length ? 560 : 490,
    },
  ];
}

function faseComercialV2(): Peca[] {
  return [
    {
      offset: 0,
      kind: "text",
      opening: true,
      text: "Olá! Aqui é o Cícero, da Campo Soberano. Para eu te orientar sem mandar informação que não serve para sua necessidade, escolha um assunto abaixo.",
    },
    {
      offset: 70,
      kind: "list",
      opening: true,
      text: "Como posso ajudar?",
      buttonLabel: "Escolher assunto",
      sections: [{
        title: "Atendimento",
        rows: [
          { id: "menu_preco", title: "Consultar opções" },
          { id: "menu_uso", title: "Escolher finalidade" },
          { id: "menu_humano", title: "Falar com Cícero" },
        ],
      }],
    },
  ];
}

// FASES representa a jornada usada em novas inscrições. A antiga sequência longa permanece
// exportada apenas para leitura/teste de filas históricas; nenhum reenvio é feito aqui.
export const FASES_LEGADAS: (() => Peca[])[] = [
  fase1,
  fase2,
  fase3,
  fase4,
  fase5,
];
export const FASES: (() => Peca[])[] = [faseComercialV2];

// calcula o timestamp de início (ms) de cada acesso: encadeia GAPS a partir do fim (lista de
// fechamento) do acesso anterior e aplica horário comercial. Garante que o acesso cabe inteiro.
export function iniciosDosAcessos(
  agora: number,
  gaps: number[],
  skipClamp: boolean,
  immediateFirst = false,
): number[] {
  const clamp = (ms: number) =>
    skipClamp ? ms : clampBusinessTime(ms, FIM_ACESSO);
  const inicios: number[] = [];
  let fimAnterior = clamp(agora);
  for (let i = 0; i < gaps.length; i++) {
    // Automático respeita 6h-22h desde a primeira peça. Manual/fast passa skipClamp=true
    // e continua imediato, inclusive fora do horário comercial.
    const ini = i === 0
      ? immediateFirst ? agora : clamp(agora)
      : skipClamp
      ? fimAnterior + gaps[i] * 1000
      : addBusinessSeconds(fimAnterior, gaps[i], FIM_ACESSO);
    inicios.push(ini);
    fimAnterior = ini + FIM_ACESSO * 1000;
  }
  return inicios;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!confereSegredo(token, [env("CHATWOOT_WEBHOOK_SECRET")], "funil-enroll")) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Json;
  const cwConvId = Number(body.chatwoot_conversation_id);
  if (!cwConvId) {
    return json({ error: "chatwoot_conversation_id obrigatório" }, 400);
  }
  const force = body.force === true || body.force === "true";
  const requestedOpeningReason = body.opening_reason === "intent_answered" ||
      body.opening_reason === "human_handoff"
    ? body.opening_reason
    : null;
  const skipOpening = body.skip_opening === true &&
    requestedOpeningReason !== null;
  const allowedOriginSignals = new Set([
    "meta_referral",
    "persisted_ad_origin",
    "default_ad_message",
    "social_opening",
    "configured_keyword",
  ]);
  const originSignal = allowedOriginSignals.has(String(body.origin_signal))
    ? String(body.origin_signal)
    : null;

  const db = admin();
  const { data: conv, error: conversationError } = await db.from("conversations").select(
    "id, chatwoot_conversation_id, contacts(attributes)",
  )
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (conversationError) {
    return json({ error: `falha ao consultar conversa: ${conversationError.message}` }, 500);
  }
  if (!conv) return json({ error: "conversa não encontrada" }, 404);

  // Contato marcado com a etiqueta "nao-compra" (bridge/handlers/funil-control.ts,
  // ação marcar-nao-compra) nunca mais entra no funil -- nem auto-enroll, nem clique manual
  // "iniciar funil", nem recuperação, porque os três caminhos convergem nesta função.
  const allowPaid = body.allow_paid === true || body.allow_paid === "true";
  if (isContactBlocked(conv.contacts) ||
    (!allowPaid && isContactExcludedFromAutomation(conv.contacts))) {
    return json({ ok: false, blocked: "contato-bloqueado" }, 422);
  }

  // dedup: já está no funil? force=true -> limpa a sequência + a fila antiga e re-enfileira
  // (re-teste). Chave por conversation_id (UUID) -- pega linhas com chatwoot_conversation_id nulo.
  const { data: existing, error: existingError } = await db.from("sales_sequences").select("id")
    .eq("conversation_id", conv.id).eq("funnel", FUNNEL).maybeSingle();
  if (existingError) {
    return json({ error: `falha ao consultar sequência: ${existingError.message}` }, 500);
  }
  if (existing) {
    if (!force) return json({ ok: true, already: true });
    await db.from("scheduled_messages").delete().eq("conversation_id", conv.id);
    await db.from("sales_sequences").delete().eq("conversation_id", conv.id).eq(
      "funnel",
      FUNNEL,
    );
  }

  // carrega a faixa e agrupa por dia+slot pra sortear
  const { data: media } = await db.from("funnel_media").select(
    "day,slot,url,caption,type",
  )
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

  const fast = body.fast === true || body.fast === "true";
  const turbo = body.turbo === true || body.turbo === "true";
  const manual = body.manual === true || body.manual === "true";
  const agora = Date.now();
  // TURBO (teste): começa agora, mas encadeia cada fase depois do fechamento da anterior.
  // Assim o teste cabe em ~45min sem misturar as aberturas, mídias e botões das fases.
  const turboGaps = [0, 0, 0, 0, 0];
  const inicios = turbo
    ? iniciosDosAcessos(agora, turboGaps, true)
    : fast
    ? iniciosDosAcessos(agora, GAPS_FAST, true)
    : iniciosDosAcessos(agora, GAPS, false, manual);
  const rows: Json[] = [];
  for (let i = 0; i < FASES.length; i++) {
    const dia = i + 1;
    for (const p of FASES[i]()) {
      if (skipOpening && "opening" in p && p.opening) continue;
      const sendAt = new Date(inicios[dia - 1] + p.offset * 1000).toISOString();
      if (p.kind === "text") {
        rows.push({
          conversation_id: conv.id,
          chatwoot_conversation_id: cwConvId,
          funnel: FUNNEL,
          day: dia,
          step: rows.length,
          type: "text",
          payload: { content: p.text },
          send_at: sendAt,
        });
      } else if (p.kind === "text_sequence") {
        rows.push({
          conversation_id: conv.id,
          chatwoot_conversation_id: cwConvId,
          funnel: FUNNEL,
          day: dia,
          step: rows.length,
          type: "text_sequence",
          payload: { texts: p.texts },
          send_at: sendAt,
        });
      } else if (p.kind === "interactive") {
        const header = p.headerSlot
          ? pick(p.mediaDay ?? dia, p.headerSlot)
          : null;
        const payload: Json = { text: p.text, buttons: p.buttons };
        if (header?.url) payload.header_image = header.url;
        rows.push({
          conversation_id: conv.id,
          chatwoot_conversation_id: cwConvId,
          funnel: FUNNEL,
          day: dia,
          step: rows.length,
          type: "interactive",
          payload,
          send_at: sendAt,
        });
      } else if (p.kind === "list") {
        const payload: Json = {
          text: p.text,
          button_label: p.buttonLabel,
          sections: p.sections,
        };
        rows.push({
          conversation_id: conv.id,
          chatwoot_conversation_id: cwConvId,
          funnel: FUNNEL,
          day: dia,
          step: rows.length,
          type: "list",
          payload,
          send_at: sendAt,
        });
      } else {
        const m = pick(p.mediaDay ?? dia, p.slot);
        if (!m?.url) continue; // sem mídia cadastrada nesse slot -> pula
        const payload: Json = { media_url: m.url };
        const cap = (p.caption ?? "") || (m.caption as string ?? "");
        if (cap && p.mediaType !== "audio") payload.caption = cap;
        rows.push({
          conversation_id: conv.id,
          chatwoot_conversation_id: cwConvId,
          funnel: FUNNEL,
          day: dia,
          step: rows.length,
          type: p.mediaType,
          payload,
          send_at: sendAt,
        });
      }
    }
  }

  const { error: sequenceError } = await db.from("sales_sequences").insert({
    conversation_id: conv.id,
    chatwoot_conversation_id: cwConvId,
    funnel: FUNNEL,
    status: "running",
  });
  if (sequenceError) {
    if ((sequenceError as { code?: string }).code === "23505") {
      return json({ ok: true, already: true });
    }
    return json(
      { error: `falha ao criar sequência: ${sequenceError.message}` },
      500,
    );
  }
  if (rows.length > 0) {
    const { error } = await db.from("scheduled_messages").insert(rows);
    if (error) return json({ error: error.message }, 500);
  }

  const { error: versionEventError } = await db.from("events").insert({
    source: "sales-funnel",
    event_type: "commercial_funnel_enrolled_v2",
    payload: {
      conversation_id: conv.id,
      chatwoot_conversation_id: cwConvId,
      version: 2,
      origin_signal: originSignal,
      opening_skipped: skipOpening,
      opening_reason: skipOpening ? requestedOpeningReason : null,
    },
  });
  if (versionEventError) {
    console.warn("funil v2: falha ao registrar versão:", versionEventError.message);
  }

  return json({ ok: true, enfileiradas: rows.length });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Entrada AUTOMÁTICA no funil (leads de anúncio) ─────────────────────────────
// Liga via env (desligado se não setar):
//   FUNIL_AUTO_ENROLL_CHANNEL = nome ou external_id do canal (ex: "5895")
//   FUNIL_KEYWORD             = (opcional) só entra se a msg contiver a palavra-chave do anúncio
// Chamado pelo hub-webhook a cada entrada. Dedup: 1 funil por conversa (sales_sequences).
const CANAIS_SOCIAIS = new Set(["facebook", "instagram"]);

/** Frases extras de anúncio, para acrescentar um icebreaker novo sem deploy. */
export function icebreakersConfigurados(): string[] {
  return (optionalEnv("FUNIL_ICEBREAKERS") ?? "")
    .split("|").map((f) => f.trim()).filter(Boolean);
}

/**
 * É a PRIMEIRA mensagem de um lead social e tem cara de pergunta de anúncio?
 *
 * A exigência de ser a primeira é o que separa "lead que chegou pelo anúncio" de "cliente
 * de duas semanas que agora perguntou o preço" — o segundo não deve cair numa sequência de
 * apresentação. `autoEnrollFunil` roda a cada mensagem recebida, então sem essa checagem a
 * regra pegaria qualquer menção a preço no meio da conversa.
 */
export async function ehAberturaDeAnuncioSocial(
  db: ReturnType<typeof admin>,
  channel: Json,
  from: string,
  content: string,
  activeConversationId?: string,
): Promise<boolean> {
  if (!CANAIS_SOCIAIS.has(String(channel.type ?? ""))) return false;
  if (!pareceAberturaComercial(content, icebreakersConfigurados())) return false;

  let conversationId = activeConversationId;
  if (!conversationId) {
    const { data: contact, error: contactError } = await db.from("contacts").select("id")
      .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return false;
    const { data: conv, error: conversationError } = await db.from("conversations").select("id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if (conversationError) throw conversationError;
    conversationId = conv?.id as string | undefined;
  }
  if (!conversationId) return false;

  // 1 = a que acabou de ser gravada. Acima disso a conversa já estava em andamento.
  const { count, error: messageCountError } = await db.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId).eq("direction", "in");
  if (messageCountError) throw messageCountError;
  return (count ?? 0) <= 1;
}

export type AutoEnrollResult = {
  adOrigin: boolean;
  humanHandoff: boolean;
};

type EnrollOpeningOptions = {
  skipOpening?: boolean;
  openingReason?: "intent_answered" | "human_handoff";
  originSignal?: string;
  conversation?: Json | null;
};

type EnrollOutcome =
  | "created"
  | "already"
  | "blocked"
  | "in_progress"
  | "no_contact"
  | "no_conversation";

async function activeConversationForContact(
  db: ReturnType<typeof admin>,
  channel: Json,
  from: string,
): Promise<Json | null> {
  const { data: contact, error: contactError } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  if (contactError) throw contactError;
  if (!contact) return null;

  const { data: conversation, error: conversationError } = await db.from("conversations")
    .select("id, chatwoot_conversation_id, origem")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (conversationError) throw conversationError;
  return conversation as Json | null;
}

function parecePerguntaDeAnuncio(content: string): boolean {
  const text = content.trim();
  return text.includes("?") ||
    pareceAberturaComercial(text, icebreakersConfigurados());
}

export async function autoEnrollFunil(
  db: ReturnType<typeof admin>,
  channel: Json,
  from: string,
  content: string,
  fromAd = false,
  options: { responseWillHandle?: boolean } = {},
): Promise<AutoEnrollResult> {
  const conversation = await activeConversationForContact(db, channel, from);
  let originSignal: string | null = fromAd
    ? "meta_referral"
    : conversation?.origem === "anuncio"
    ? "persisted_ad_origin"
    : isDefaultAdMessage(content)
    ? "default_ad_message"
    : null;

  // Facebook e Instagram: pergunta comercial NA ABERTURA vale como lead de anúncio.
  //
  // Nesses dois canais a Meta não manda `referral` quando o lead escolhe uma das perguntas
  // prontas do anúncio -- conferido nas 15 conversas de 03-08/09: referral, ad_id, ctwa_clid
  // e source_url vazios em todas. Sem outro sinal, o texto é o que resta.
  //
  // Só na abertura, e só nesses canais. No WhatsApp a inscrição já funciona por outro caminho
  // (63 de 67 aberturas comerciais entraram no funil nos mesmos 5 dias), e alargar a regra lá
  // pegaria quem chega por indicação, não por anúncio.
  if (!originSignal && await ehAberturaDeAnuncioSocial(
    db,
    channel,
    from,
    content,
    String(conversation?.id ?? "") || undefined,
  )) {
    originSignal = "social_opening";
  }

  // Sinais de anúncio têm precedência: preço, dúvida técnica e demais intenções não podem
  // impedir a inscrição quando a Meta ou a conversa já confirmou a origem.
  if (!originSignal) {
    // Um pedido orgânico já claro deve ir para sua resposta imediata, sem régua paralela.
    if (classificarIntencaoComercial(content)) {
      return { adOrigin: false, humanHandoff: false };
    }

    const alvo = (optionalEnv("FUNIL_AUTO_ENROLL_CHANNEL") ?? "").trim();
    if (!alvo || (channel.name !== alvo && channel.external_id !== alvo)) {
      return { adOrigin: false, humanHandoff: false };
    }
    const kw = (optionalEnv("FUNIL_KEYWORD") ?? "").trim();
    // Match tolerante: ignora maiúsculas/minúsculas e acentos.
    if (kw && !foldText(content).includes(foldText(kw))) {
      return { adOrigin: false, humanHandoff: false };
    }
    originSignal = "configured_keyword";
  }

  const unsupportedQuestion = !options.responseWillHandle &&
    parecePerguntaDeAnuncio(content);
  const openingReason = options.responseWillHandle
    ? "intent_answered"
    : unsupportedQuestion
    ? "human_handoff"
    : undefined;

  let outcome: EnrollOutcome;
  try {
    outcome = await enrollIfNew(db, channel, from, {
      skipOpening: Boolean(openingReason),
      openingReason,
      originSignal,
      conversation,
    });
  } catch (error) {
    console.error("autoEnrollFunil inscrição falhou:", error);
    outcome = "in_progress";
  }

  return {
    adOrigin: true,
    humanHandoff: unsupportedQuestion && outcome !== "blocked" &&
      outcome !== "no_contact" && outcome !== "no_conversation",
  };
}

export async function enrollIfNew(
  db: ReturnType<typeof admin>,
  channel: Json,
  from: string,
  options: EnrollOpeningOptions = {},
): Promise<EnrollOutcome> {
  const conv = options.conversation ?? await (async () => {
    const { data: contact, error: contactError } = await db.from("contacts").select("id")
      .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
    if (contactError) throw contactError;
    if (!contact) return null;
    const { data: conversation, error: conversationError } = await db.from("conversations")
      .select("id, chatwoot_conversation_id, origem")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle();
    if (conversationError) throw conversationError;
    return conversation as Json | null;
  })();
  if (!options.conversation && !conv) return "no_contact";
  if (!conv) return "no_conversation";
  if (!conv.chatwoot_conversation_id) return "no_conversation";

  const claimKey = `funil-enroll-${String(conv.id)}`;
  if (!await claimDeliveryWithTtl(db, claimKey, "funil-enroll", 2 * 60_000)) {
    return "in_progress";
  }

  try {
    const { data: existing, error: existingError } = await db.from("sales_sequences").select("id")
      .eq("conversation_id", conv.id).eq("funnel", FUNNEL).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return "already";

    const token = encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"));
    const response = await handle(
      new Request(`http://internal/funil-enroll?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatwoot_conversation_id: conv.chatwoot_conversation_id,
          skip_opening: options.skipOpening === true,
          opening_reason: options.openingReason ?? null,
          origin_signal: options.originSignal ?? null,
        }),
      }),
    );
    const result = await response.json().catch(() => ({})) as Json;
    if (response.status === 422 && result.blocked) return "blocked";
    if (!response.ok || result.error) {
      throw new Error(`funil-enroll HTTP ${response.status}`);
    }
    const outcome = result.already === true ? "already" : "created";
    console.log(
      "enrollIfNew:",
      "conv",
      conv.chatwoot_conversation_id,
      outcome,
      "opening_skipped",
      options.skipOpening === true,
      "origin_signal",
      options.originSignal ?? "none",
    );
    return outcome;
  } finally {
    await releaseDelivery(db, claimKey);
  }
}

export async function recoverEligibleFunnels(
  db: ReturnType<typeof admin>,
  sinceHours = 48,
): Promise<{ scanned: number; eligible: number; enrolled: number }> {
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000)
    .toISOString();
  const { data: conversations, error } = await db.from("conversations")
    .select(
      "id,channel_id,contact_id,chatwoot_conversation_id,origem,status,opened_at",
    )
    .neq("status", "resolved").gte("opened_at", since)
    .order("opened_at", { ascending: false }).limit(500);
  if (error) throw error;
  if (!conversations?.length) return { scanned: 0, eligible: 0, enrolled: 0 };

  const conversationIds = conversations.map((item: Json) => item.id);
  const contactIds = conversations.map((item: Json) => item.contact_id);
  const channelIds = conversations.map((item: Json) => item.channel_id);
  // Em lotes, e erro sobe em vez de virar lista vazia: com `existing` vazio por falha de
  // consulta, conversa já inscrita pareceria elegível de novo. Cada conversa cai num lote só,
  // então "a entrada mais recente por conversa" continua certa com a ordem por lote.
  const [existing, inbound, contacts, channels] = await Promise.all([
    consultaEmLotes<Json>(
      conversationIds,
      (lote) => db.from("sales_sequences").select("conversation_id").in("conversation_id", lote),
    ),
    consultaEmLotes<Json>(
      conversationIds,
      (lote) =>
        db.from("messages").select("conversation_id,content,sent_at")
          .in("conversation_id", lote)
          .eq("direction", "in").order("sent_at", { ascending: false }).limit(3000),
    ),
    consultaEmLotes<Json>(
      contactIds,
      (lote) => db.from("contacts").select("id,external_contact_id").in("id", lote),
    ),
    consultaEmLotes<Json>(
      channelIds,
      (lote) => db.from("channels").select("*").in("id", lote),
    ),
  ]);
  const enrolledIds = new Set(
    (existing ?? []).map((item: Json) => String(item.conversation_id)),
  );
  const latestInbound = new Map<string, string>();
  for (const item of inbound ?? []) {
    const key = String(item.conversation_id);
    if (!latestInbound.has(key)) {
      latestInbound.set(key, String(item.content ?? ""));
    }
  }
  const contactMap = new Map(
    (contacts ?? []).map((item: Json) => [String(item.id), item]),
  );
  const channelMap = new Map(
    (channels ?? []).map((item: Json) => [String(item.id), item]),
  );
  let eligible = 0;
  let enrolled = 0;
  for (const conversation of conversations as Json[]) {
    if (
      enrolledIds.has(String(conversation.id)) ||
      !conversation.chatwoot_conversation_id
    ) continue;
    const content = latestInbound.get(String(conversation.id)) ?? "";
    if (conversation.origem !== "anuncio" && !isDefaultAdMessage(content)) {
      continue;
    }
    eligible++;
    const contact = contactMap.get(String(conversation.contact_id)) as
      | Json
      | undefined;
    const channel = channelMap.get(String(conversation.channel_id)) as
      | Json
      | undefined;
    if (!contact?.external_contact_id || !channel) continue;
    await enrollIfNew(db, channel, String(contact.external_contact_id));
    enrolled++;
  }
  return { scanned: conversations.length, eligible, enrolled };
}
