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
const DIA = 86_400; // segundos

// Roteiro fixo dos 4 dias. offset = segundos a partir do enroll. mídia ('image'|'audio'|'video')
// puxa do slot na faixa; texto/interactive são inline.
type Peca =
  | { offset: number; kind: "text"; text: string }
  | { offset: number; kind: "interactive"; text: string; buttons: { id: string; title: string }[]; headerSlot?: string }
  | { offset: number; kind: "media"; mediaType: "image" | "audio" | "video"; slot: string; caption?: string };

function roteiro(): Peca[] {
  const pecas: Peca[] = [];
  for (let dia = 1; dia <= 4; dia++) {
    const base = (dia - 1) * DIA;
    if (dia === 1) {
      pecas.push({ offset: base, kind: "text", text: "Olá, tudo bem? 😊👋\n\nAqui é o *Cícero Sobreira* 👨‍🌾\n\nO senhor se interessou nas sementes do *Mega Sorgo Santa Elisa*?" });
      pecas.push({ offset: base + 40, kind: "media", mediaType: "image", slot: "image", caption: "Sou representante da *Campo Soberano* 🌾🚜\n\nEspecialistas no *Mega Sorgo Santa Elisa* 🔥" });
      pecas.push({ offset: base + 80, kind: "interactive", headerSlot: "image", text: "O senhor já conhece o *Mega Sorgo Santa Elisa*?\n\nJá viu a alta produção dele? 🤔📈", buttons: [
        { id: "conhece_sim", title: "Já conheço ✅" }, { id: "conhece_nao", title: "Não conheço 🤔" }, { id: "tem_duvida", title: "Tenho dúvida ❓" } ] });
    } else if (dia === 2) {
      pecas.push({ offset: base, kind: "text", text: "Olha que beleza! 🌱🔥\n\n🌾 Passa de *5 METROS* de altura!\n📈 Mais de *140 TONELADAS* por hectare!" });
      pecas.push({ offset: base + 40, kind: "media", mediaType: "image", slot: "image", caption: "🌾 *Mega Sorgo Santa Elisa* — Safra 2027 🏆" });
      pecas.push({ offset: base + 80, kind: "interactive", text: "O senhor trabalha com gado de leite ou de corte? 🐄", buttons: [
        { id: "gado_leite", title: "Leite 🥛" }, { id: "gado_corte", title: "Corte 🥩" }, { id: "gado_ambos", title: "Os dois 🐄" } ] });
    } else if (dia === 3) {
      pecas.push({ offset: base, kind: "text", text: "Quer saber o segredo dele? 🤫\n\n🌽 Ele *REBROTA*! Rende mais que o milho\n🔥 E é *80% superior* ao Capiaçu na silagem!" });
      pecas.push({ offset: base + 40, kind: "media", mediaType: "image", slot: "image", caption: "Silagem de *alta qualidade* — seu gado come melhor 🐄" });
      pecas.push({ offset: base + 80, kind: "interactive", text: "Quer ver o vídeo da lavoura de perto? 🎬", buttons: [ { id: "ver_video", title: "Sim, quero ver ▶️" } ] });
    } else {
      pecas.push({ offset: base, kind: "text", text: "💪 Resistente a *praga* (lagarta, cigarrinha)\n☀️ E aguenta bem a *seca*!\n\n🚜 Garanta suas sementes pra *Safra 2027*!" });
      pecas.push({ offset: base + 40, kind: "media", mediaType: "image", slot: "image", caption: "🏆 Quem entende de resultado planta *Mega Sorgo Santa Elisa*!" });
      pecas.push({ offset: base + 80, kind: "interactive", text: "O senhor quer saber o preço? 💰", buttons: [
        { id: "quer_preco", title: "Quero o preço 💰" }, { id: "falar_vendedor", title: "Falar c/ vendedor 👨‍🌾" } ] });
    }
    // áudios e vídeo de cada dia (da faixa, rotação)
    pecas.push({ offset: base + 300, kind: "media", mediaType: "audio", slot: "audio1" });
    pecas.push({ offset: base + 330, kind: "media", mediaType: "audio", slot: "audio2" });
    pecas.push({ offset: base + 600, kind: "media", mediaType: "video", slot: "video", caption: "" });
  }
  return pecas;
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
  const rows: Json[] = [];
  let dia = 0, lastBase = -1;
  for (const p of roteiro()) {
    // descobre o dia pela base do offset (cada dia múltiplo de DIA)
    if (p.offset % DIA === 0 && p.offset !== lastBase) { /* marcador */ }
    dia = Math.floor(p.offset / DIA) + 1;
    const sendAt = new Date(agora + p.offset * 1000).toISOString();
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
