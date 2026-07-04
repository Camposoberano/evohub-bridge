// hub-webhook — recebe webhooks do EVO Hub.
//  * lifecycle (event_type): channel_connected / channel_disconnected / channel_auto_imported
//  * passthrough Meta (object): whatsapp_business_account / page / instagram
//
// Fase 1: WhatsApp TEXTO ponta a ponta (Meta -> Chatwoot + Postgres).
// FB/IG e mídia: evento é persistido; tradução fica para Fase 2/3 (TODO marcados).
import { admin, claimDelivery } from "../shared/supabase.ts";
import { verifyHubSignature } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { getChannelDetail, getMeta, sendMeta } from "../shared/hub.ts";
import { ingestInbound, type InboundAttachment } from "../shared/inbound.ts";
import { numKey, readCampaigns, writeCampaigns } from "../shared/campaigns.ts";
import { isNativeChannel } from "../shared/native.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { createConversationMessage, type CwAcct } from "../shared/chatwoot.ts";
import { autoEnrollFunil } from "./funil-enroll.ts";
import { isPrecoIntent, isVideoIntent, transcribeAudio } from "../shared/intent.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const WA_MEDIA_TYPES = new Set(["image", "audio", "video", "document", "sticker"]);
const GRAPH_VERSION = optionalEnv("META_GRAPH_VERSION") ?? "v21.0";

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const raw = await req.text();
  const sig = req.headers.get("X-Hub-Signature-256");
  const deliveryId = req.headers.get("X-Hub-Delivery-Id");

  if (!(await verifyHubSignature(env("EVOLUTION_HUB_WEBHOOK_SECRET"), raw, sig))) {
    return new Response("invalid signature", { status: 401 });
  }

  const db = admin();

  if (!(await claimDelivery(db, deliveryId, "hub"))) {
    return new Response("ok (dup)", { status: 200 });
  }

  let payload: Json;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  await db.from("events").insert({
    source: "hub",
    event_type: (payload.event_type as string) ?? (payload.event as string) ?? (payload.object as string) ?? "unknown",
    payload,
    occurred_at: (payload.occurred_at as string) ?? null,
  });

  try {
    const eventType = payload.event_type as string | undefined;
    if (eventType && ["channel_connected", "channel_disconnected", "channel_auto_imported"].includes(eventType)) {
      await handleLifecycle(db, payload);
    } else if (payload.object === "whatsapp_business_account") {
      await handleWhatsApp(db, payload);
    } else if (payload.object === "page" || payload.object === "instagram") {
      await handleMessenger(db, payload);
    } else {
      console.log("passthrough não tratado:", payload.object);
    }
  } catch (e) {
    console.error("hub-webhook erro:", e);
    return new Response("ok (logged error)", { status: 200 });
  }

  return new Response("ok", { status: 200 });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function handleLifecycle(db: Db, p: Json) {
  const externalId = p.external_id as string;
  const hubChannelId = p.channel_id as string;
  const eventType = p.event_type as string;

  const patch: Json = { hub_channel_id: hubChannelId ?? null };

  if (eventType === "channel_connected" || eventType === "channel_auto_imported") {
    patch.status = "active";
    patch.connected_at = new Date().toISOString();

    // O webhook channel_connected é magro (sem meta_connection). Buscamos o detalhe no Hub
    // pra extrair page_id (FB) / phone_number_id+waba_id (WA) / ig_id (IG).
    const detail = await getChannelDetail(hubChannelId);
    if (detail) {
      const fb = (detail.facebook_connection ?? {}) as Json;
      const wa = (detail.whatsapp_connection ?? detail.meta_connection ?? {}) as Json;
      const ig = (detail.instagram_connection ?? {}) as Json;
      if (fb.page_id) { patch.page_id = fb.page_id; patch.display_name = fb.page_name ?? null; }
      if (wa.phone_number_id) {
        patch.phone_number_id = wa.phone_number_id;
        patch.waba_id = wa.waba_id ?? null;
        patch.phone_number = wa.phone_number ?? null;
        patch.display_name = (patch.display_name as string | undefined) ?? wa.display_name ?? null;
      }
      const igId = ig.instagram_user_id ?? ig.ig_id ?? ig.instagram_id ?? ig.id;
      if (igId) {
        patch.ig_id = igId;
        patch.display_name = (patch.display_name as string | undefined) ?? ig.username ?? null;
      }
      // channel_token vem no detalhe — guarda/atualiza (idempotente).
      if (detail.token) {
        await db.from("channel_secrets").upsert({ channel_id: externalId, channel_token: detail.token as string });
      }
    }
  } else if (eventType === "channel_disconnected") {
    patch.status = "inactive";
  }

  await db.from("channels").update(patch).eq("id", externalId);
}

// ── WhatsApp passthrough (entrada) ───────────────────────────────────────────
async function handleWhatsApp(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    for (const change of ((entry.changes ?? []) as Json[])) {
      const value = (change.value ?? {}) as Json;
      const phoneNumberId = (value.metadata as Json)?.phone_number_id as string | undefined;
      if (!phoneNumberId) continue;

      const { data: channel } = await db.from("channels").select("*").eq("phone_number_id", phoneNumberId).maybeSingle();
      if (!channel?.chatwoot_inbox_identifier) {
        console.warn("canal sem inbox_identifier p/ phone_number_id", phoneNumberId);
        continue;
      }

      // Status de saída (sent/delivered/read/failed) — atualiza messages e marca número morto.
      const statuses = (value.statuses ?? []) as Json[];
      if (statuses.length > 0) await handleWhatsAppStatuses(db, channel as Json, statuses);

      // Mídia WhatsApp baixa direto na Graph API com o token Meta (Usuário do Sistema da
      // WABA). O Hub está em modo "shared" e não expõe download de binário; o channel_token
      // do Hub não autentica a lookaside. META_ACCESS_TOKEN é o token da sua WABA.
      const metaToken = optionalEnv("META_ACCESS_TOKEN");

      // Canal nativo: a entrada/echo já chega na caixa nativa do Chatwoot pelo repasse do EVO Hub.
      // Aqui o bridge NÃO posta no Chatwoot (evita duplicata) — só persiste no banco (analytics)
      // e roda o motor de campanha.
      const native = await isNativeChannel(channel.phone_number_id as string | undefined);
      const acct = await accountForChannel(channel.id as string); // conta Chatwoot do canal (multi-cliente)

      // Echoes: mensagem enviada PELO APARELHO (modo coexistência app+API).
      // Vem em message_echoes (não em messages) -> entra como SAÍDA na conversa do cliente.
      // Dedup por meta_message_id: echo de msg que NÓS mandamos via API já está no banco -> pula.
      const echoes = (value.message_echoes ?? []) as Json[];
      for (const e of echoes) {
        const to = e.to as string;
        if (!to) continue;
        const { content, attachments } = await extractWaContent(e, e.type as string, metaToken, channel.id as string);
        await ingestInbound(db, channel as Json, {
          from: to, metaMessageId: e.id as string, msgType: e.type as string, content, attachments, outgoing: true, skipChatwoot: native, acct,
        });
      }

      const contactsMeta = (value.contacts ?? []) as Json[];
      const messages = (value.messages ?? []) as Json[];
      if (messages.length === 0) continue;

      for (const m of messages) {
        const from = m.from as string;
        const profileName = (contactsMeta.find((c) => (c.wa_id as string) === from)?.profile as Json)?.name as string | undefined;

        const type = m.type as string;
        const menuClick = type === "interactive" ? interactiveReplyId(m) : null;
        const { content, attachments } = menuClick
          ? { content: menuClick.title, attachments: undefined }
          : await extractWaContent(m, type, metaToken, channel.id as string);

        await ingestInbound(db, channel as Json, {
          from,
          name: profileName,
          metaMessageId: m.id as string,
          msgType: type,
          content,
          attachments,
          skipChatwoot: native,
          acct,
          // CTWA/free entry point: lead clicou em anúncio -> janela de 72h (origem='anuncio').
          referral: (m.referral as Json | undefined) ?? undefined,
        });

        // Menu de ação do funil (lista/botão clicado pelo cliente) -> entrega o conteúdo na
        // hora, em qualquer fase, sem esperar o roteiro chegar lá.
        if (menuClick?.id.startsWith("menu_")) {
          try { await handleMenuClick(db, channel as Json, from, menuClick.id, acct); }
          catch (e) { console.error("handleMenuClick erro:", e); }
        }
        // botões da sequência de preço (🛒 comprar / 📦 escolher tamanho / tam_*).
        if (menuClick && (menuClick.id.startsWith("preco_") || menuClick.id.startsWith("tam_") || menuClick.id.startsWith("pag_"))) {
          try { await handlePrecoClick(db, channel as Json, from, menuClick.id, acct); }
          catch (e) { console.error("handlePrecoClick erro:", e); }
        }

        // gated campaign: cliente respondeu → janela aberta → dispara a sequência.
        try { await resumeCampaign(db, channel as Json, from); } catch (e) { console.error("resumeCampaign erro:", e); }

        // entrada automática no funil (leads de anúncio) -- só age se FUNIL_AUTO_ENROLL_CHANNEL
        // estiver setado e este for o canal alvo (+ FUNIL_KEYWORD, se configurada).
        try { await autoEnrollFunil(db, channel as Json, from, content ?? ""); } catch (e) { console.error("autoEnrollFunil erro:", e); }

        // Intenção de PREÇO — três portas, mesma resposta do botão 💰 Preço:
        //   botão   -> menu_preco (tratado acima)
        //   texto   -> "preço/valor/quanto custa/orçamento..." (tolerante a acento/maiúscula)
        //   áudio   -> transcrito via Whisper (só se OPENAI_API_KEY existir; sem chave, ignora)
        // Auto-responde 1x/dia por contato (claim) — repetiu no mesmo dia, humano assume.
        if (!menuClick) {
          try {
            let intentText = content ?? "";
            let transcricao: string | null = null;
            if (type === "audio" && attachments?.length) {
              transcricao = await transcribeAudio(attachments[0].bytes, attachments[0].contentType);
              if (transcricao) intentText = transcricao;
            }
            if (isPrecoIntent(intentText)) {
              const dia = new Date().toISOString().slice(0, 10);
              if (await claimDelivery(db, `intent-preco-${channel.id}-${from}-${dia}`, "intent")) {
                await handleMenuClick(db, channel as Json, from, "menu_preco", acct);
                // nota privada com o gatilho (transcrição do áudio ou frase) — contexto pro atendente.
                if (transcricao) {
                  const { data: ct } = await db.from("contacts").select("id").eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
                  const { data: cv } = ct
                    ? await db.from("conversations").select("chatwoot_conversation_id").eq("contact_id", ct.id).neq("status", "resolved").order("opened_at", { ascending: false }).limit(1).maybeSingle()
                    : { data: null };
                  if (cv?.chatwoot_conversation_id) {
                    try {
                      await createConversationMessage(cv.chatwoot_conversation_id as number, {
                        content: `🎙️ *Áudio transcrito (disparou tabela de preço automática):*\n\n"${transcricao.slice(0, 400)}"`,
                        messageType: "outgoing", private: true,
                      }, acct);
                    } catch { /* nota é bônus */ }
                  }
                }
              }
            } else if (isVideoIntent(intentText)) {
              const dia = new Date().toISOString().slice(0, 10);
              if (await claimDelivery(db, `intent-video-${channel.id}-${from}-${dia}`, "intent")) {
                await handleVideoSequence(db, channel as Json, from, acct);
                if (transcricao) {
                  const { data: ct2 } = await db.from("contacts").select("id").eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
                  const { data: cv2 } = ct2
                    ? await db.from("conversations").select("chatwoot_conversation_id").eq("contact_id", ct2.id).neq("status", "resolved").order("opened_at", { ascending: false }).limit(1).maybeSingle()
                    : { data: null };
                  if (cv2?.chatwoot_conversation_id) {
                    try {
                      await createConversationMessage(cv2.chatwoot_conversation_id as number, {
                        content: `🎙️ *Áudio transcrito (disparou sequência de vídeos automática):*\n\n"${transcricao.slice(0, 400)}"`,
                        messageType: "outgoing", private: true,
                      }, acct);
                    } catch { /* nota é bônus */ }
                  }
                }
              }
            }
          } catch (e) { console.error("intent erro:", e); }
        }
      }
    }
  }
}

// Extrai o id+título da opção clicada (botão ou item de lista) de uma msg interactive.
function interactiveReplyId(m: Json): { id: string; title: string } | null {
  const interactive = m.interactive as Json | undefined;
  const br = interactive?.button_reply as Json | undefined;
  if (br?.id) return { id: br.id as string, title: (br.title as string) ?? (br.id as string) };
  const lr = interactive?.list_reply as Json | undefined;
  if (lr?.id) return { id: lr.id as string, title: (lr.title as string) ?? (lr.id as string) };
  return null;
}

// Conteúdo do menu de ação (funil Mega Sorgo) — preço é real (igual já usado manualmente pelo
// Cícero); plantio/nutrição/depoimento são placeholder até o material real chegar.
const MENU_CONTENT: Record<string, string> = {
  menu_preco: "🌱 *Tabela de preços — Mega Sorgo Santa Elisa®*\n\n📦 2 kg — R$ 179,90 (cobre 0,5 hectare)\n📦 4 kg — R$ 341,62 (cobre 1 hectare)\n📦 10 kg — de R$ 899,00 por R$ 764,15 (cobre 2 hectares)\n📦 20 kg — R$ 1.437,90 (cobre até 4 hectares)\n\n🚚 Frete grátis pra todo o Brasil!",
  menu_plantio: "🌱 Em breve te mando o passo a passo completo de plantio (época, adubação, espaçamento). Qualquer dúvida me chama aqui! — Cícero",
  menu_nutricao: "🧪 Em breve te mando os dados nutricionais completos (comparativo com milho/Capiaçu). Qualquer dúvida me chama aqui! — Cícero",
  menu_depoimento: "🎬 Em breve te mando os vídeos de quem já plantou e aprovou! Qualquer dúvida me chama aqui! — Cícero",
  menu_humano: "🧑‍🌾 Já te conectei com o Cícero, ele te chama em breve!",
};

// ── Sequência de PREÇO (v2, 02/07): imagem -> tabela c/ validade dinâmica -> botões ─────────
// Material real do Cícero (promoção Safra-Safrinha). Validade SEMPRE hoje+5 dias (o formato
// antigo usava data fixa e ficava vencida no ar). Descontos reais: 2kg sem / 4kg 5% / 10kg 15% / 20kg 20%.
const PRECO_VALIDADE_DIAS = 5;

function precoValidade(): string {
  const d = new Date(Date.now() + PRECO_VALIDADE_DIAS * 24 * 60 * 60 * 1000);
  const brt = new Date(d.getTime() - 3 * 3600 * 1000);
  return `${String(brt.getUTCDate()).padStart(2, "0")}/${String(brt.getUTCMonth() + 1).padStart(2, "0")}/${brt.getUTCFullYear()}`;
}

// Cartão de preço POR PACOTE (decisão 02/07: tabelona completa confunde e atrasa a venda —
// pergunta a ÁREA primeiro e entrega só o preço certo). Card + pagamento; frete vai em
// mensagem separada; fechamento com botões.
// Card enxuto (decisão 02/07 v4): foco em "X kg atende Y hectares" + preço + desconto E
// frete grátis SEMPRE juntos como promoção. Pagamento vai em mensagem DEDICADA (confiança).
function precoCard(pacote: string, cobre: string, precoDe: string | null, precoPor: string, off: string | null): string {
  const linhaPreco = precoDe ? `💰 De ${precoDe} por *${precoPor}*` : `💰 *${precoPor}*`;
  const promo = off
    ? `💸 *${off} de desconto + FRETE GRÁTIS* — tudo dentro da promoção!`
    : `💸 *FRETE GRÁTIS* dentro da promoção!`;
  return `🌱 *Pacote de ${pacote} — atende ${cobre}*\n\n${linhaPreco}\n${promo}\n📅 Promoção válida até *${precoValidade()}*`;
}

const PAGAMENTO_MSG = "💳 *Formas de pagamento — como o senhor preferir:*\n\n" +
  "▪️ *PIX direto com a empresa* (no CNPJ) — rápido, sem burocracia\n\n" +
  "▪️ *Cartão de crédito ou débito*\n" +
  "*Pelo site, com a Garantia Mercado Pago* 🛡️ — o banco oficial do Mercado Livre.\n" +
  "Compra 100% protegida: o pagamento só é liberado pra gente *depois que o senhor recebe a semente*. " +
  "Se não chegar, o Mercado Pago devolve seu dinheiro. Segurança total pro senhor comprar tranquilo.\n\n" +
  "▪️ *Boleto*\n" +
  "Também pelo site, com a Garantia Mercado Pago.\n" +
  "_Liberação do pedido em 2 dias após a confirmação do pagamento._";

const FRETE_MSG = "🚚 *FRETE GRÁTIS para todo o Brasil!*\n\n📦 Enviamos por Correios ou transportadora, com código de rastreio pro senhor acompanhar a entrega.";

// função (não constante!): a validade é hoje+5 e precisa ser calculada NO ENVIO, não no boot.
function tamanhoCard(id: string): string | null {
  switch (id) {
    case "tam_2kg": return precoCard("2 kg", "½ hectare (meio hectare)", null, "R$ 179,90", null);
    case "tam_4kg": return precoCard("4 kg", "1 hectare", "R$ 359,60", "R$ 341,62", "5%");
    case "tam_10kg": return precoCard("10 kg", "2 hectares", "R$ 899,00", "R$ 764,15", "15%");
    case "tam_20kg": return precoCard("20 kg", "até 4 hectares", "R$ 1.798,00", "R$ 1.437,90", "20%");
    default: return null;
  }
}

async function handlePrecoSequence(db: Db, channel: Json, from: string, acct?: CwAcct): Promise<void> {
  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;
  const path = `${phone}/messages`;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Fluxo v5.2 (04/07): banner -> lista de área -> imagem pacote -> card -> frete -> botões.
  const pecas: { body: Json; registro: string; tipo: string }[] = [];
  // 1) banner promoção (funnel_media slot 'preco'; sem mídia -> pula)
  const { data: media } = await db.from("funnel_media").select("url,caption")
    .eq("funnel", "mega-sorgo").eq("slot", "preco").eq("active", true).limit(1).maybeSingle();
  if (media?.url) {
    pecas.push({
      tipo: "image",
      body: { type: "image", image: { link: media.url, caption: "Vou te passar os valores! 👇" } },
      registro: "[imagem promoção]",
    });
  }
  // 2) lista de área (botão "Quer saber o preço?")
  pecas.push({
    tipo: "interactive",
    body: {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "📐 Pra te passar o preço certinho, preciso saber: qual o tamanho da área que o senhor vai plantar?" },
        action: { button: "Quer saber o preço?", sections: [{ title: "Tamanho da área", rows: [
          { id: "tam_2kg", title: "Até ½ hectare", description: "meio hectare" },
          { id: "tam_4kg", title: "Até 1 hectare" },
          { id: "tam_10kg", title: "2 hectares" },
          { id: "tam_20kg", title: "4 hectares ou mais" },
        ] } ] },
      },
    },
    registro: "📐 Qual o tamanho da área? [½ ha / 1 ha / 2 ha / 4+ ha]",
  });

  const { data: contact } = await db.from("contacts").select("id").eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  for (const [i, p] of pecas.entries()) {
    const r = await sendMeta(token, path, { messaging_product: "whatsapp", to: from, ...p.body });
    const metaId = (r.data as Json)?.messages ? (((r.data as Json).messages as Json[])[0]?.id as string) : null;
    // chatwoot_message_id no insert é OBRIGATÓRIO: sem ele o pull-loop sync-chatwoot-out acha a
    // msg "órfã" no Chatwoot e reenvia como texto (duplicação vista no teste v3).
    let cwMsgId: number | null = null;
    if (conv?.chatwoot_conversation_id) {
      try {
        const cw = await createConversationMessage(conv.chatwoot_conversation_id as number, { content: p.registro, messageType: "outgoing" }, acct);
        cwMsgId = (cw?.id as number) ?? null;
      } catch { /* registro é bônus */ }
    }
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null, channel_id: channel.id, direction: "out",
      msg_type: p.tipo === "image" ? "image" : (p.tipo === "interactive" ? "interactive" : "text"),
      content: p.registro, meta_message_id: metaId, chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed", sent_at: new Date().toISOString(),
    });
    if (i < pecas.length - 1) await pause(2500);
  }
}

// clique nos botões da sequência de preço.
async function handlePrecoClick(db: Db, channel: Json, from: string, id: string, acct?: CwAcct): Promise<void> {
  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;
  const path = `${phone}/messages`;

  const { data: contact } = await db.from("contacts").select("id").eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  // registra no Chatwoot e DEVOLVE o id — o id precisa ir pro insert em messages
  // (chatwoot_message_id), senão o pull-loop sync-chatwoot-out acha a msg "órfã" no Chatwoot
  // e REENVIA como texto (causa da duplicação do card/frete vista no teste v3).
  const registra = async (texto: string, priv = false): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(conv.chatwoot_conversation_id as number, { content: texto, messageType: "outgoing", private: priv }, acct);
      return (cw?.id as number) ?? null;
    } catch { return null; }
  };
  const envia = async (body: Json, registro: string, tipo: string) => {
    const r = await sendMeta(token, path, { messaging_product: "whatsapp", to: from, ...body });
    const metaId = (r.data as Json)?.messages ? (((r.data as Json).messages as Json[])[0]?.id as string) : null;
    const cwMsgId = await registra(registro);
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null, channel_id: channel.id, direction: "out", msg_type: tipo,
      content: registro, meta_message_id: metaId, chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed", sent_at: new Date().toISOString(),
    });
  };

  if (id === "preco_pagamento") {
    await envia({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "💳 *Como o senhor prefere pagar?*" },
        action: { buttons: [
          { type: "reply", reply: { id: "pag_pix", title: "PIX" } },
          { type: "reply", reply: { id: "pag_cartao", title: "Cartão" } },
          { type: "reply", reply: { id: "pag_boleto", title: "Boleto" } },
        ] },
      },
    }, "Como prefere pagar? [PIX / Cartão / Boleto]", "interactive");
    return;
  }

  if (id === "pag_pix") {
    await envia({ type: "text", text: { body: "💰 *PIX direto com a empresa* (no CNPJ) — rápido, sem burocracia!\n\nO Cícero vai te enviar a chave PIX pra concluir o pedido." } },
      "PIX direto com a empresa", "text");
    await registra("🔥 *LEAD QUENTE — escolheu PIX.* Enviar chave e fechar!", true);
    return;
  }

  if (id === "pag_cartao") {
    await envia({ type: "text", text: { body: "💳 *Cartão de crédito ou débito*\n\n*Pelo site, com a Garantia Mercado Pago* 🛡️ — o banco oficial do Mercado Livre.\n\nCompra 100% protegida: o pagamento só é liberado pra gente *depois que o senhor recebe a semente*. Se não chegar, o Mercado Pago devolve seu dinheiro.\n\nO Cícero vai te enviar o link do site pra concluir!" } },
      "Cartão de crédito/débito via Mercado Pago", "text");
    await registra("🔥 *LEAD QUENTE — escolheu Cartão.* Enviar link Mercado Pago!", true);
    return;
  }

  if (id === "pag_boleto") {
    await envia({ type: "text", text: { body: "📄 *Boleto bancário*\n\nTambém pelo site, com a *Garantia Mercado Pago* 🛡️.\n\n_Liberação do pedido em 2 dias após a confirmação do pagamento._\n\nO Cícero vai te enviar o link pra gerar o boleto!" } },
      "Boleto via Mercado Pago", "text");
    await registra("🔥 *LEAD QUENTE — escolheu Boleto.* Enviar link Mercado Pago!", true);
    return;
  }

  if (id === "preco_comprar") {
    const texto = "🤝 *Fechado!* O Cícero vai te chamar em instantes pra concluir o pedido.\n\n💳 PIX direto com a empresa ou pelo site com Mercado Pago — como o senhor preferir!";
    await envia({ type: "text", text: { body: texto } }, texto, "text");
    await registra("🔥 *LEAD QUENTE — clicou 🛒 QUERO GARANTIR na tabela de preço.* Fechar a venda AGORA!", true);
    return;
  }

  if (id === "preco_tamanho") {
    await envia({
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "📐 Me diz o tamanho da área que o senhor quer plantar:" },
        action: { button: "Quer saber o preço?", sections: [{ title: "Tamanho da área", rows: [
          { id: "tam_2kg", title: "Até ½ hectare", description: "meio hectare" },
          { id: "tam_4kg", title: "Até 1 hectare" },
          { id: "tam_10kg", title: "2 hectares" },
          { id: "tam_20kg", title: "4 hectares ou mais" },
        ] } ] },
      },
    }, "📐 Me diz o tamanho da área [½ ha / 1 ha / 2 ha / 4+ ha]", "interactive");
    return;
  }

  // Clique na área -> 4 tempos: imagem pacote -> card texto -> frete -> botões (pagamento virou botão).
  const card = tamanhoCard(id);
  if (card) {
    const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));
    // imagem do pacote (funnel_media slot preco_2kg/preco_4kg/preco_10kg/preco_20kg)
    const imgSlot = `preco_${id.replace("tam_", "")}`;
    const { data: imgMedia } = await db.from("funnel_media").select("url,caption")
      .eq("funnel", "mega-sorgo").eq("slot", imgSlot).eq("active", true).limit(1).maybeSingle();
    if (imgMedia?.url) {
      await envia(
        { type: "image", image: { link: imgMedia.url, caption: (imgMedia.caption as string) || "" } },
        `[imagem ${imgSlot}]`, "image",
      );
      await pause(2500);
    }
    await envia({ type: "text", text: { body: card } }, card, "text");
    await pause(2500);
    await envia({ type: "text", text: { body: FRETE_MSG } }, FRETE_MSG, "text");
    await pause(2500);
    await envia({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Posso garantir o seu? 👇" },
        action: { buttons: [
          { type: "reply", reply: { id: "preco_comprar", title: "🛒 Quero garantir" } },
          { type: "reply", reply: { id: "preco_pagamento", title: "💳 Pagamento" } },
          { type: "reply", reply: { id: "preco_tamanho", title: "📦 Outra área" } },
        ] },
      },
    }, "Posso garantir o seu? [🛒 Quero garantir / 💳 Pagamento / 📦 Outra área]", "interactive");
  }
}

// ── Sequência de VÍDEOS (5 vídeos com pausa entre eles) ─────────────────────
const VIDEO_CAPTIONS: Record<string, string> = {
  video_1: "🌿 *VÍDEO 01 — O que é o Mega Sorgo Santa Elisa?*\n\n✅ Semente de *alto rendimento* que produz silagem e pastagem de qualidade o ano inteiro\n✅ Cresce rápido, rebrota forte e aguenta seca\n\n👉 _Assista e descubra por que milhares de produtores já plantam:_\nhttps://youtu.be/Q7IDP7PuYd4",
  video_2: "🌾 *VÍDEO 02 — Como plantar o Mega Sorgo Santa Elisa*\n\n✅ Plantio *simples*, sem segredo — até quem nunca plantou consegue\n✅ Dicas de *espaçamento, época ideal e adubação*\n\n👉 _Veja o passo a passo completo:_\nhttps://youtu.be/mkzRsa8RaKw",
  video_3: "📊 *VÍDEO 03 — Resultados reais no campo*\n\n✅ Produtores mostram *na prática* o que colheram\n✅ Comparativo com milho e outras forrageiras — os números impressionam\n\n👉 _Confira os resultados com os próprios olhos:_\nhttps://youtu.be/J6xJyYDukhw",
  video_4: "🌽 *VÍDEO 04 — Silagem com qualidade e volume o ano inteiro*\n\n✅ *Até 3 cortes por safra* — alta produção de massa verde\n✅ Versatilidade: serve pra silagem, pastejo direto e fenação\n\n👉 _Veja como garantir volume na sua propriedade:_\nhttps://youtu.be/Z-HrHiMsUIE",
  video_5: "🛡️ *VÍDEO 05 — Gaste menos e produza mais!*\n\n✅ *Resistência natural* a cigarrinha, lagarta e pulgão — menos veneno, menos custo\n✅ Redução real nos gastos com silagem e pastagem\n\n👉 _Descubra como economizar na sua produção:_\nhttps://youtu.be/rbfOQBoRX5Y",
};
const VIDEO_PAUSE_MS = 60_000;

async function handleVideoSequence(db: Db, channel: Json, from: string, acct?: CwAcct): Promise<void> {
  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;
  const msgPath = `${phone}/messages`;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const { data: contact } = await db.from("contacts").select("id").eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const registra = async (texto: string, priv = false): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(conv.chatwoot_conversation_id as number, { content: texto, messageType: "outgoing", private: priv }, acct);
      return (cw?.id as number) ?? null;
    } catch { return null; }
  };
  const envia = async (body: Json, registro: string, tipo: string) => {
    const r = await sendMeta(token, msgPath, { messaging_product: "whatsapp", to: from, ...body });
    const metaId = (r.data as Json)?.messages ? (((r.data as Json).messages as Json[])[0]?.id as string) : null;
    const cwMsgId = await registra(registro);
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null, channel_id: channel.id, direction: "out", msg_type: tipo,
      content: registro, meta_message_id: metaId, chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed", sent_at: new Date().toISOString(),
    });
  };

  // intro
  await envia(
    { type: "text", text: { body: "📹 *Preparei 5 vídeos curtos pra você conhecer o Mega Sorgo Santa Elisa!*\n\nÉ rápido — cada um mostra um ponto importante pra sua decisão.\n\nVou mandar um por um, assista com calma 👇" } },
    "📹 Preparei 5 vídeos curtos — vou mandar um por um", "text",
  );
  await pause(3000);

  // busca vídeos do funnel_media (slots video_1..video_5)
  const slots = ["video_1", "video_2", "video_3", "video_4", "video_5"];
  const { data: videos } = await db.from("funnel_media").select("slot,url,caption")
    .eq("funnel", "mega-sorgo").in("slot", slots).eq("active", true);

  const videoMap = new Map((videos ?? []).map((v: Json) => [v.slot as string, v]));

  for (const [i, slot] of slots.entries()) {
    const media = videoMap.get(slot) as Json | undefined;
    const caption = (media?.caption as string) || VIDEO_CAPTIONS[slot] || "";

    if (media?.url) {
      const r = await sendMeta(token, msgPath, { messaging_product: "whatsapp", to: from, type: "video", video: { link: media.url, caption } });
      if (r.ok) {
        const metaId = (r.data as Json)?.messages ? (((r.data as Json).messages as Json[])[0]?.id as string) : null;
        const cwMsgId = await registra(`[vídeo ${i + 1}] ${caption.slice(0, 80)}...`);
        await db.from("messages").insert({
          conversation_id: conv?.id ?? null, channel_id: channel.id, direction: "out", msg_type: "video",
          content: `[vídeo ${i + 1}]`, meta_message_id: metaId, chatwoot_message_id: cwMsgId,
          status: "sent", sent_at: new Date().toISOString(),
        });
      } else {
        // fallback: vídeo grande demais ou erro -> envia caption como texto
        await envia({ type: "text", text: { body: caption } }, caption, "text");
      }
    } else {
      await envia({ type: "text", text: { body: caption } }, caption, "text");
    }
    if (i < slots.length - 1) await pause(VIDEO_PAUSE_MS);
  }

  // CTA final
  await pause(4000);
  await envia({
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "✅ *Esses são os 5 pontos que todo produtor precisa saber antes de plantar!*\n\nQuer saber o preço e as condições especiais da promoção?" },
      action: { buttons: [
        { type: "reply", reply: { id: "menu_preco", title: "💰 Ver preço" } },
        { type: "reply", reply: { id: "menu_humano", title: "🧑‍🌾 Falar com Cícero" } },
      ] },
    },
  }, "✅ 5 pontos importantes! [💰 Ver preço / 🧑‍🌾 Falar com Cícero]", "interactive");

  await registra("🎬 *Sequência de 5 vídeos enviada automaticamente.* Cliente pediu informações.", true);
}

async function handleMenuClick(db: Db, channel: Json, from: string, menuId: string, acct?: CwAcct): Promise<void> {
  // preço virou SEQUÊNCIA (imagem + tabela dinâmica + botões) — delega.
  if (menuId === "menu_preco") return await handlePrecoSequence(db, channel, from, acct);
  if (menuId === "menu_depoimento") return await handleVideoSequence(db, channel, from, acct);
  const content = MENU_CONTENT[menuId];
  if (!content) return;

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;

  const r = await sendMeta(token, `${phone}/messages`, { messaging_product: "whatsapp", to: from, type: "text", text: { body: content } });
  const metaId = (r.data as Json)?.messages ? (((r.data as Json).messages as Json[])[0]?.id as string) : null;

  const { data: contact } = await db.from("contacts").select("id").eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  // chatwoot_message_id no insert é OBRIGATÓRIO — sem ele o pull-loop sync-chatwoot-out acha
  // a msg "órfã" no Chatwoot e reenvia como texto (duplicação).
  let cwMsgId: number | null = null;
  if (conv?.chatwoot_conversation_id) {
    try {
      const cw = await createConversationMessage(conv.chatwoot_conversation_id as number, { content, messageType: "outgoing" }, acct);
      cwMsgId = (cw?.id as number) ?? null;
    } catch (e) { console.warn("handleMenuClick: registro Chatwoot falhou", String(e).slice(0, 150)); }
  }

  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: "text",
    content,
    meta_message_id: metaId,
    chatwoot_message_id: cwMsgId,
    status: r.ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });
}

// Erros da Meta que indicam número inexistente / não-WhatsApp (número morto).
const DEAD_NUMBER_ERRORS = new Set([131026, 131051, 131047, 131000]);

async function handleWhatsAppStatuses(db: Db, channel: Json, statuses: Json[]) {
  for (const s of statuses) {
    const wamid = stringValue(s.id);
    const status = stringValue(s.status); // sent | delivered | read | failed
    if (!wamid || !status) continue;

    // ordem: não regredir read->delivered. Atualiza só se "avança" ou é failed.
    const patch: Json = { status };
    // custo: categoria de cobrança da Meta (service/marketing/utility/authentication/
    // referral_conversion). Base pra ver o gasto real quando a cobrança mudar (ago-out/2026).
    const pricingCategory = ((s.pricing as Json | undefined)?.category as string | undefined) ??
      ((s.conversation as Json | undefined)?.origin as Json | undefined)?.type as string | undefined;
    if (pricingCategory) patch.pricing_category = pricingCategory;
    await db.from("messages").update(patch).eq("meta_message_id", wamid).eq("direction", "out");

    if (status === "failed") {
      const errors = (s.errors ?? []) as Json[];
      const code = errors[0]?.code as number | undefined;
      const recipient = stringValue(s.recipient_id);
      if (recipient && code && DEAD_NUMBER_ERRORS.has(code)) {
        // marca contato como número morto (attributes.dead) p/ limpar das campanhas.
        const { data: contact } = await db.from("contacts").select("id,attributes")
          .eq("channel_id", channel.id).eq("external_contact_id", recipient).maybeSingle();
        if (contact) {
          const attrs = (contact.attributes ?? {}) as Json;
          await db.from("contacts").update({
            attributes: { ...attrs, dead: true, dead_reason: code, dead_at: new Date().toISOString() },
          }).eq("id", contact.id);
        }
      }
    }
  }
}

// ── Messenger / Instagram passthrough (entrada) ──────────────────────────────
async function handleMessenger(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    const pageId = entry.id as string | undefined; // page_id (FB) ou ig id
    if (!pageId) continue;

    const { data: channel } = await db.from("channels").select("*")
      .or(`page_id.eq.${pageId},ig_id.eq.${pageId}`).maybeSingle();
    if (!channel?.chatwoot_inbox_identifier) {
      console.warn("sem canal p/ page/ig id", pageId);
      continue;
    }

    for (const m of ((entry.messaging ?? []) as Json[])) {
      const sender = (m.sender as Json)?.id as string | undefined;
      const message = m.message as Json | undefined;
      if (!sender || !message) continue; // ignora delivery/read/postback sem texto
      if (message.is_echo) continue; // ignora echo das mensagens enviadas pela própria página
      if (hasMessengerAttachments(message)) continue; // o sync-facebook baixa e envia a mídia real
      const text = (message.text as string) ?? "[anexo]"; // TODO Fase 3: mídia/attachments

      // o webhook não manda o nome do remetente -- a Graph API devolve via GET /{id}?fields=name
      // mesmo quando o evento não traz (comum no Instagram). Sem isso, Chatwoot cria nome
      // aleatório tipo "fragrant-feather-524".
      const name = await fetchSenderName(db, channel.id as string, sender);

      await ingestInbound(db, channel as Json, {
        from: sender,
        name,
        metaMessageId: (message.mid as string) ?? "",
        msgType: "text",
        content: text,
      });
    }
  }
}

async function fetchSenderName(db: Db, channelId: string, senderId: string): Promise<string | undefined> {
  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channelId).maybeSingle();
  if (!secret?.channel_token) return undefined;
  try {
    const res = await getMeta(secret.channel_token, `${senderId}?fields=name`);
    if (!res.ok) return undefined;
    return (res.data as Json).name as string | undefined;
  } catch (e) {
    console.warn("fetchSenderName falhou", senderId, String(e).slice(0, 150));
    return undefined;
  }
}

// ── Campanha gated: resposta do cliente dispara a sequência (janela 24h aberta) ──
async function resumeCampaign(db: Db, channel: Json, from: string) {
  const key = numKey(from);
  const state = await readCampaigns();
  const t = state.targets[key];
  if (!t || t.status !== "awaiting") return; // só dispara quem está aguardando resposta
  const camp = state.campaigns.find((c) => c.id === t.campaignId);
  if (!camp) return;

  // marca ativo já (evita disparo duplo se chegar 2 msgs juntas)
  t.status = "active";
  await writeCampaigns(state);

  const { data: secret } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;

  for (const step of camp.steps) {
    let body: Json;
    if (step.type === "text") {
      if (!step.text) continue; // texto vazio = pula
      body = { messaging_product: "whatsapp", to: key, type: "text", text: { body: step.text } };
    } else {
      if (!step.file) continue; // mídia sem URL = pula (não quebra a sequência)
      const media: Json = { link: step.file };
      // áudio NÃO aceita caption na Cloud API; image/video/document aceitam.
      if (step.type !== "audio" && step.text) media.caption = step.text;
      if (step.type === "document" && step.text) media.filename = step.text;
      body = { messaging_product: "whatsapp", to: key, type: step.type, [step.type]: media };
    }
    const r = await sendMeta(token, `${phone}/messages`, body);
    if (!r.ok) console.error(`resumeCampaign step falhou (${step.type}):`, JSON.stringify((r.data as Json)?.error ?? r.data).slice(0, 200));
  }

  // marca concluído
  const s2 = await readCampaigns();
  if (s2.targets[key]) { s2.targets[key].status = "done"; s2.targets[key].step = camp.steps.length; s2.targets[key].ts = new Date().toISOString(); await writeCampaigns(s2); }
}

function hasMessengerAttachments(message: Json): boolean {
  const attachments = message.attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

// ── Mídia WhatsApp (entrada) ──────────────────────────────────────────────────
// Baixa direto na Graph API da Meta (o Hub em modo shared não serve o binário):
// 1) GET graph.facebook.com/<ver>/<media_id> com Bearer <metaToken> -> { url, mime_type, file_size }
// 2) fetch(url) com Bearer <metaToken> -> bytes (lookaside exige o token Meta)
async function downloadWhatsAppMedia(metaToken: string, mediaId: string, filenameHint?: string): Promise<InboundAttachment | null> {
  const auth = { Authorization: `Bearer ${metaToken}` };
  const infoRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, { headers: auth });
  if (!infoRes.ok) {
    console.warn("WA mídia metadata falhou", infoRes.status, (await infoRes.text()).slice(0, 200));
    return null;
  }
  const d = await infoRes.json().catch(() => ({})) as Json;
  const url = stringValue(d.url);
  if (!url) return null;

  const declaredSize = typeof d.file_size === "number" ? d.file_size : null;
  if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) return null;

  const res = await fetch(url, { headers: auth });
  if (!res.ok) { console.warn("WA mídia download falhou", res.status); return null; }

  const length = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_ATTACHMENT_BYTES) return null;

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) return null;

  const contentType = cleanContentType(res.headers.get("content-type")) ??
    cleanContentType(d.mime_type as string | undefined) ??
    "application/octet-stream";

  return {
    filename: filenameHint ?? `${mediaId}${extensionForMime(contentType)}`,
    contentType,
    bytes,
    sourceUrl: url,
  };
}

// Extrai texto + anexo de uma mensagem/echo WhatsApp (mesmo formato p/ inbound e echo).
async function extractWaContent(
  m: Json, type: string, metaToken: string | undefined, channelId: string,
): Promise<{ content: string; attachments?: InboundAttachment[] }> {
  if (type === "text") return { content: ((m.text as Json)?.body as string) ?? "" };
  if (WA_MEDIA_TYPES.has(type)) {
    const media = (m[type] ?? {}) as Json;
    const mediaId = stringValue(media.id);
    const caption = stringValue(media.caption);
    const filenameHint = type === "document" ? stringValue(media.filename) ?? undefined : undefined;
    if (!metaToken) console.warn("WA mídia sem META_ACCESS_TOKEN — usando placeholder", channelId);
    const downloaded = metaToken && mediaId ? await downloadWhatsAppMedia(metaToken, mediaId, filenameHint) : null;
    // anexo baixou: conteúdo = legenda (ou vazio; sem rótulo "[audio]"). Sem anexo: placeholder textual.
    if (downloaded) return { content: caption ?? "", attachments: [downloaded] };
    return { content: caption ?? fallbackContent(type) };
  }
  return { content: `[${type}]` }; // tipo sem tradução (location/contacts/interactive/etc.)
}

function fallbackContent(type: string): string {
  if (type === "image") return "[imagem]";
  if (type === "audio") return "[audio]";
  if (type === "video") return "[video]";
  if (type === "document") return "[documento]";
  if (type === "sticker") return "[sticker]";
  return "[anexo]";
}

function cleanContentType(value: string | null | undefined): string | null {
  const clean = value?.split(";")[0]?.trim().toLowerCase();
  return clean || null;
}

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/mp4" || mime === "video/mp4") return ".mp4";
  if (mime === "audio/ogg") return ".ogg";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
