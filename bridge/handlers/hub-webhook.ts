// hub-webhook — recebe webhooks do EVO Hub.
//  * lifecycle (event_type): channel_connected / channel_disconnected / channel_auto_imported
//  * passthrough Meta (object): whatsapp_business_account / page / instagram
//
// Fase 1: WhatsApp TEXTO ponta a ponta (Meta -> Chatwoot + Postgres).
// FB/IG e mídia: evento é persistido; tradução fica para Fase 2/3 (TODO marcados).
import { admin, claimDelivery, releaseDelivery } from "../shared/supabase.ts";
import { redactSecrets, sufixoContato } from "../shared/redact.ts";
import { verifyHubSignature } from "../shared/hmac.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { getChannelDetail, getMeta, sendMeta } from "../shared/hub.ts";
import { type InboundAttachment, ingestInbound } from "../shared/inbound.ts";
import { numKey, readCampaigns, writeCampaigns } from "../shared/campaigns.ts";
import { isNativeChannel } from "../shared/native.ts";
import { accountForChannel } from "../shared/accounts.ts";
import {
  assignConversation,
  createConversationMessage,
  type CwAcct,
  getConversationLabels,
  setConversationLabels,
} from "../shared/chatwoot.ts";
import { autoEnrollFunil, enrollIfNew } from "./funil-enroll.ts";
import { autoPauseFunil } from "../shared/funnel-state.ts";
import { registrarPedidoHumano } from "../shared/pedido-humano.ts";
import {
  OPCOES_DE_USO,
  classificarIntencaoComercial,
  extrairAreaHectares,
  isAreaAcimaDosPacotes,
  pacotePorId,
  registrarEventoComercial,
  textoCondicaoComercial,
  textoPerguntaUso,
  usoPorResposta,
} from "../shared/funil-comercial.ts";
import { isBotMutedForContact } from "../shared/bot-mute.ts";
import { isNegativeIntent } from "../shared/negative-intent.ts";
import { stopContactAutomation } from "../shared/stop-contact.ts";
import { continueFlowOnReply } from "../shared/flow-inbound.ts";
import {
  isComprovanteMsgType,
  isDuvidaTecnicaIntent,
  isFechamentoIntent,
  isNutricaoIntent,
  isPlantioIntent,
  isPrecoIntent,
  isVideoIntent,
  transcribeAudio,
} from "../shared/intent.ts";
import {
  getHybridRoute,
  hybridSendMedia,
  hybridSendText,
} from "../shared/hybrid.ts";
import { toVoiceOgg } from "../shared/audio.ts";
import {
  claimDailyIntent,
  claimDailyTag,
  type CommercialIntent,
  releaseDailyIntent,
} from "../shared/intent-dedup.ts";
import { type Isca, matchIsca } from "../shared/iscas.ts";
import { parseSocialCommentChanges } from "../shared/social.ts";
import { maybeAutoReplySocialComment } from "../shared/social-autoreply.ts";
import { handle as sendOutbound } from "./send-outbound.ts";
import { metaErrorDetail } from "../shared/meta-errors.ts";
import { sendFunnelDocument } from "../shared/document-delivery.ts";
import {
  inferSocialPriceReplyFromPrompts,
  socialPriceActionClaimKey,
} from "../shared/social-funnel.ts";
import {
  inferSocialSalesIntent,
  salesContactImageFallback,
  salesWhatsAppUrl,
  SOCIAL_INFO_TEXT,
  socialContactText,
  inferSocialMenuAction,
  socialSalesClaimKey,
  type SocialSalesIntent,
} from "../shared/social-sales.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_WEBHOOK_BODY_BYTES = 4 * 1024 * 1024;
const WA_MEDIA_TYPES = new Set([
  "image",
  "audio",
  "video",
  "document",
  "sticker",
]);
const GRAPH_VERSION = optionalEnv("META_GRAPH_VERSION") ?? "v21.0";

async function readBoundedBody(req: Request): Promise<string | Response> {
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      return new Response("invalid content length", { status: 400 });
    }
    if (Number(declaredLength) > MAX_WEBHOOK_BODY_BYTES) {
      return new Response("payload too large", { status: 413 });
    }
  }

  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BODY_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // O limite já foi atingido; não há corpo útil a preservar.
        }
        return new Response("payload too large", { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response("invalid request body", { status: 400 });
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const body = await readBoundedBody(req);
  if (body instanceof Response) return body;
  const raw = body;
  const sig = req.headers.get("X-Hub-Signature-256");
  const deliveryId = req.headers.get("X-Hub-Delivery-Id");

  if (
    !(await verifyHubSignature(env("EVOLUTION_HUB_WEBHOOK_SECRET"), raw, sig))
  ) {
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
    event_type: (payload.event_type as string) ?? (payload.event as string) ??
      (payload.object as string) ?? "unknown",
    payload: redactSecrets(payload),
    occurred_at: (payload.occurred_at as string) ?? null,
  });

  try {
    const eventType = payload.event_type as string | undefined;
    if (
      eventType &&
      ["channel_connected", "channel_disconnected", "channel_auto_imported"]
        .includes(eventType)
    ) {
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
    await releaseDelivery(db, deliveryId).catch((releaseError) =>
      console.error("hub-webhook release delivery erro:", releaseError)
    );
    await db.from("events").insert({
      source: "hub",
      event_type: "processing_failed",
      payload: {
        delivery_id: deliveryId,
        error: e instanceof Error ? e.message : String(e),
      },
    });
    return new Response("processing failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
async function handleLifecycle(db: Db, p: Json) {
  const externalId = p.external_id as string | undefined;
  const hubChannelId = p.channel_id as string;
  const eventType = p.event_type as string;

  // Canais criados diretamente no EVO Hub chegam sem external_id. Depois que o
  // canal e importado, o hub_channel_id passa a ser o vinculo estavel local.
  let localChannelId: string | undefined = externalId;
  if (!localChannelId && hubChannelId) {
    const { data: imported } = await db.from("channels").select("id").eq(
      "hub_channel_id",
      hubChannelId,
    ).maybeSingle();
    localChannelId = imported?.id as string | undefined;
  }
  if (!localChannelId) {
    console.warn("lifecycle sem canal local", hubChannelId, eventType);
    return;
  }

  const patch: Json = { hub_channel_id: hubChannelId ?? null };

  if (
    eventType === "channel_connected" || eventType === "channel_auto_imported"
  ) {
    patch.status = "active";
    patch.connected_at = new Date().toISOString();

    // O webhook channel_connected é magro (sem meta_connection). Buscamos o detalhe no Hub
    // pra extrair page_id (FB) / phone_number_id+waba_id (WA) / ig_id (IG).
    const detail = await getChannelDetail(hubChannelId);
    if (detail) {
      const fb = (detail.facebook_connection ?? {}) as Json;
      const wa =
        (detail.whatsapp_connection ?? detail.meta_connection ?? {}) as Json;
      const ig = (detail.instagram_connection ?? {}) as Json;
      if (fb.page_id) {
        patch.page_id = fb.page_id;
        patch.display_name = fb.page_name ?? null;
      }
      if (wa.phone_number_id) {
        patch.phone_number_id = wa.phone_number_id;
        patch.waba_id = wa.waba_id ?? null;
        patch.phone_number = wa.phone_number ?? null;
        patch.display_name = (patch.display_name as string | undefined) ??
          wa.display_name ?? null;
      }
      const igId = ig.instagram_user_id ?? ig.ig_id ?? ig.instagram_id ?? ig.id;
      if (igId) {
        patch.ig_id = igId;
        patch.display_name = (patch.display_name as string | undefined) ??
          ig.username ?? null;
      }
      // channel_token vem no detalhe — guarda/atualiza (idempotente).
      if (detail.token) {
        await db.from("channel_secrets").upsert({
          channel_id: localChannelId,
          channel_token: detail.token as string,
        });
      }
    }
  } else if (eventType === "channel_disconnected") {
    patch.status = "inactive";
  }

  await db.from("channels").update(patch).eq("id", localChannelId);
}

// ── WhatsApp passthrough (entrada) ───────────────────────────────────────────
async function handleWhatsApp(db: Db, p: Json) {
  const entries = (p.entry ?? []) as Json[];
  for (const entry of entries) {
    for (const change of ((entry.changes ?? []) as Json[])) {
      const value = (change.value ?? {}) as Json;
      const phoneNumberId = (value.metadata as Json)?.phone_number_id as
        | string
        | undefined;
      if (!phoneNumberId) continue;

      const { data: channel } = await db.from("channels").select("*").eq(
        "phone_number_id",
        phoneNumberId,
      ).maybeSingle();
      if (!channel?.chatwoot_inbox_identifier) {
        console.warn(
          "canal sem inbox_identifier p/ phone_number_id",
          phoneNumberId,
        );
        continue;
      }

      // Status de saída (sent/delivered/read/failed) — atualiza messages e marca número morto.
      const statuses = (value.statuses ?? []) as Json[];
      if (statuses.length > 0) {
        await handleWhatsAppStatuses(db, channel as Json, statuses);
      }

      // Mídia WhatsApp baixa direto na Graph API com o token Meta (Usuário do Sistema da
      // WABA). O Hub está em modo "shared" e não expõe download de binário; o channel_token
      // do Hub não autentica a lookaside. META_ACCESS_TOKEN é o token da sua WABA.
      const metaToken = optionalEnv("META_ACCESS_TOKEN");

      // Canal nativo: a entrada/echo já chega na caixa nativa do Chatwoot pelo repasse do EVO Hub.
      // Aqui o bridge NÃO posta no Chatwoot (evita duplicata) — só persiste no banco (analytics)
      // e roda o motor de campanha.
      const native = await isNativeChannel(
        channel.phone_number_id as string | undefined,
      );
      const acct = await accountForChannel(channel.id as string); // conta Chatwoot do canal (multi-cliente)

      // Echoes: mensagem enviada PELO APARELHO (modo coexistência app+API).
      // Vem em message_echoes (não em messages) -> entra como SAÍDA na conversa do cliente.
      // Dedup por meta_message_id: echo de msg que NÓS mandamos via API já está no banco -> pula.
      const echoes = (value.message_echoes ?? []) as Json[];
      for (const e of echoes) {
        const to = e.to as string;
        if (!to) continue;
        const { content, attachments } = await extractWaContent(
          e,
          e.type as string,
          metaToken,
          channel.id as string,
        );
        await ingestInbound(db, channel as Json, {
          from: to,
          metaMessageId: e.id as string,
          msgType: e.type as string,
          content,
          attachments,
          outgoing: true,
          skipChatwoot: native,
          acct,
        });
      }

      const contactsMeta = (value.contacts ?? []) as Json[];
      const messages = (value.messages ?? []) as Json[];
      if (messages.length === 0) continue;

      for (const m of messages) {
        const from = m.from as string;
        const profileName = (contactsMeta.find((c) =>
          (c.wa_id as string) === from
        )?.profile as Json)?.name as string | undefined;

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

        if (isNegativeIntent(content)) {
          try {
            const result = await stopContactAutomation(
              db,
              String(channel.id),
              from,
              "explicit-reply",
            );
            console.log("hub: contato bloqueado por desinteresse", JSON.stringify(result));
          } catch (e) {
            console.error("hub: falha ao encerrar desinteresse", e);
          }
          continue;
        }

        // Bot travado à mão (label bot-off no Chatwoot): a mensagem acima já foi gravada e
        // espelhada — travar o bot é parar de FALAR, não parar de escutar. Daqui pra baixo
        // é tudo resposta automática, então sai fora.
        if (
          await isBotMutedForContact(db, channel.id as string, from)
        ) {
          console.log("bot-mute: entrada ignorada pelo bot, conv de", sufixoContato(from));
          continue;
        }

        // Lead no meio de um fluxo conversacional: a resposta dele é para a pergunta do
        // fluxo, não para o bot de intenção. Consumir aqui evita duas mensagens ao mesmo
        // tempo, vindas de lógicas diferentes.
        try {
          if (
            await continueFlowOnReply(
              db,
              channel as Json,
              from,
              menuClick?.id ?? null,
            )
          ) continue;
        } catch (e) {
          console.error("flow-inbound erro:", e);
        }

        // Menu de ação do funil (lista/botão clicado pelo cliente) -> entrega o conteúdo na
        // hora, em qualquer fase, sem esperar o roteiro chegar lá.
        if (
          menuClick?.id.startsWith("menu_") &&
          await claimDelivery(db, `wa-action-${channel.id}-${m.id}-${menuClick.id}`, "wa-action")
        ) {
          try {
            if (menuClick.id === "menu_preco") {
              await recordInboundCommercialIntent(
                db, channel as Json, from, "preco", String(m.id ?? "") || null,
              );
            } else if (menuClick.id === "menu_uso") {
              await recordInboundCommercialIntent(
                db, channel as Json, from, "interesse_geral", String(m.id ?? "") || null,
              );
            }
            await handleMenuClick(
              db,
              channel as Json,
              from,
              menuClick.id,
              acct,
              String(m.id ?? "") || undefined,
            );
          } catch (e) {
            console.error("handleMenuClick erro:", e);
          }
        }
        // botões da sequência de preço (🛒 comprar / 📦 escolher tamanho / tam_*).
        if (
          menuClick &&
          (menuClick.id.startsWith("preco_") ||
            menuClick.id.startsWith("tam_") || menuClick.id.startsWith("pag_") ||
            menuClick.id.startsWith("uso_")) &&
          await claimDelivery(db, `wa-action-${channel.id}-${m.id}-${menuClick.id}`, "wa-action")
        ) {
          try {
            await handlePrecoClick(
              db,
              channel as Json,
              from,
              menuClick.id,
              acct,
              String(m.id ?? ""),
            );
          } catch (e) {
            console.error("handlePrecoClick erro:", e);
          }
        }
        // botões da sequência de plantio (plantio_1..plantio_10).
        if (
          menuClick?.id.startsWith("plantio_") &&
          await claimDelivery(db, `wa-action-${channel.id}-${m.id}-${menuClick.id}`, "wa-action")
        ) {
          try {
            await handlePlantioClick(
              db,
              channel as Json,
              from,
              menuClick.id,
              acct,
            );
          } catch (e) {
            console.error("handlePlantioClick erro:", e);
          }
        }
        // botões da sequência nutricional (nutricao_1..nutricao_10).
        if (
          menuClick?.id.startsWith("nutricao_") &&
          await claimDelivery(db, `wa-action-${channel.id}-${m.id}-${menuClick.id}`, "wa-action")
        ) {
          try {
            await handleNutricaoClick(
              db,
              channel as Json,
              from,
              menuClick.id,
              acct,
            );
          } catch (e) {
            console.error("handleNutricaoClick erro:", e);
          }
        }

        // gated campaign: cliente respondeu → janela aberta → dispara a sequência.
        try {
          await resumeCampaign(db, channel as Json, from);
        } catch (e) {
          console.error("resumeCampaign erro:", e);
        }

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
              transcricao = await transcribeAudio(
                attachments[0].bytes,
                attachments[0].contentType,
              );
              if (transcricao) intentText = transcricao;
            }
            // FECHAMENTO EM ANDAMENTO: lead mandando CEP/CPF/endereço ou o comprovante em
            // PDF. Não conclui a venda (isso continua na etiqueta, decisão humana) — só
            // pausa o funil pra nenhuma mensagem de marketing atravessar o fechamento, e
            // atribui a conversa pra alguém assumir. Ver conversa #798 (venda de 03/08):
            // o lead mandou CEP às 13:41 e fechou às 13:55.
            if (
              isFechamentoIntent(intentText) || isComprovanteMsgType(type)
            ) {
              try {
                const { data: _ctf } = await db.from("contacts").select("id")
                  .eq("channel_id", channel.id)
                  .eq("external_contact_id", from).maybeSingle();
                const { data: _cvf } = _ctf
                  ? await db.from("conversations")
                    .select("id,chatwoot_conversation_id")
                    .eq("contact_id", _ctf.id).neq("status", "resolved")
                    .order("opened_at", { ascending: false }).limit(1)
                    .maybeSingle()
                  : { data: null };
                if (_cvf) {
                  await autoPauseFunil(_cvf.id as string, "fechamento");
                  const assignee = Number(
                    optionalEnv("CHATWOOT_ASSIGNEE_ID") ?? "0",
                  );
                  const cwId = _cvf.chatwoot_conversation_id as number | null;
                  // Etiqueta ANTES de atribuir e fora do if do assignee: a nota privada some
                  // no meio da conversa e só aparece pra quem abre. A etiqueta é filtrável —
                  // vira fila de "confirmar se virou venda". Sem ela, 26 conversas com sinal
                  // de fechamento ficaram 'open' sem ninguém revisar (medido em 11/08).
                  if (cwId) await marcarRevisarVenda(cwId, acct);
                  if (assignee > 0 && cwId) {
                    await assignConversation(cwId, assignee, acct);
                    await createConversationMessage(cwId, {
                      content:
                        "📄 *FECHAMENTO EM ANDAMENTO* — o cliente enviou dados/comprovante. Funil pausado e conversa atribuída. Confira e marque a etiqueta *pago* quando confirmar o pagamento.",
                      messageType: "outgoing",
                      private: true,
                    }, acct);
                  }
                }
              } catch (e) {
                console.error("fechamento-detect erro:", e);
              }
            }

            const commercialIntent = classificarIntencaoComercial(intentText);
            if (commercialIntent) {
              await recordInboundCommercialIntent(
                db,
                channel as Json,
                from,
                commercialIntent,
                String(m.id ?? m.message_id ?? "") || null,
              );
            }
            const detectedIntent = isPrecoIntent(intentText)
              ? "preço"
              : commercialIntent === "duvida_tecnica"
              ? "duvida-tecnica"
              : commercialIntent === "uso"
              ? "uso"
              : commercialIntent === "interesse_geral"
              ? "interesse-geral"
              : isVideoIntent(intentText)
              ? "vídeo"
              : isPlantioIntent(intentText)
              ? "plantio"
              : isNutricaoIntent(intentText)
              ? "nutrição"
              : null;
            const routeWillHandle = Boolean(commercialIntent) ||
              isVideoIntent(intentText) || isPlantioIntent(intentText) ||
              isNutricaoIntent(intentText) ||
              (isAreaAcimaDosPacotes(intentText) &&
                extrairAreaHectares(intentText) !== null);
            const humanHandoffWillHandle = commercialIntent === "duvida_tecnica" ||
              (isAreaAcimaDosPacotes(intentText) &&
                extrairAreaHectares(intentText) !== null);

            // Enroll depois da transcrição para decidir a abertura com a mesma intenção que
            // será roteada. Referral/origem persistida prevalece mesmo quando há intenção.
            let adEnrollment: Awaited<ReturnType<typeof autoEnrollFunil>> | null = null;
            try {
              adEnrollment = await autoEnrollFunil(
                db,
                channel as Json,
                from,
                intentText,
                Boolean(m.referral),
                {
                  responseWillHandle: routeWillHandle && !humanHandoffWillHandle,
                  humanHandoffWillHandle,
                },
              );
            } catch (e) {
              console.error("autoEnrollFunil erro:", e);
            }
            // Qualquer intenção comercial interrompe a sequência agendada para não atravessar
            // a conversa. Se a primeira mensagem do anúncio pedir preço, o seletor de área
            // também deve aparecer agora, em vez de apenas prometer um menu futuro.
            if (detectedIntent) {
              const { data: _ct } = await db.from("contacts").select("id").eq(
                "channel_id",
                channel.id,
              ).eq("external_contact_id", from).maybeSingle();
              if (_ct) {
                const { data: _cv } = await db.from("conversations").select(
                  "id",
                ).eq("contact_id", _ct.id).neq("status", "resolved").order(
                  "opened_at",
                  { ascending: false },
                ).limit(1).maybeSingle();
                if (_cv) {
                  await autoPauseFunil(_cv.id as string, detectedIntent, {
                    // Resposta automática pausa só pelo prazo; atendimento humano espera
                    // decisão do agente e não retoma mensagens sozinho.
                    comPrazo: !humanHandoffWillHandle,
                  });
                }
              }
            }
            if (isPrecoIntent(intentText)) {
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (
                await claimDelivery(
                  db,
                  `intent-preco-${channel.id}-${from}-${intentKey}`,
                  "intent",
                )
              ) {
                const hectares = extrairAreaHectares(intentText);
                if (hectares !== null && isAreaAcimaDosPacotes(intentText)) {
                  const origem = channel.type === "facebook" || channel.type === "instagram"
                    ? "social"
                    : "whatsapp";
                  await handleHumanRequest(db, channel as Json, from, origem, acct, {
                    tipo_pedido: "cotacao_area_livre",
                    area_hectares: hectares,
                    uso: usoPorResposta(intentText),
                    regiao_uf: extrairUF(intentText),
                    message_id: String(m.id ?? m.message_id ?? "") || null,
                  });
                } else {
                  await handleMenuClick(
                    db,
                    channel as Json,
                    from,
                    "menu_preco",
                    acct,
                    String(m.id ?? m.message_id ?? "") || undefined,
                  );
                }
                // nota privada com o gatilho (transcrição do áudio ou frase) — contexto pro atendente.
                if (transcricao) {
                  const { data: ct } = await db.from("contacts").select("id")
                    .eq("channel_id", channel.id).eq(
                      "external_contact_id",
                      from,
                    ).maybeSingle();
                  const { data: cv } = ct
                    ? await db.from("conversations").select(
                      "chatwoot_conversation_id",
                    ).eq("contact_id", ct.id).neq("status", "resolved").order(
                      "opened_at",
                      { ascending: false },
                    ).limit(1).maybeSingle()
                    : { data: null };
                  if (cv?.chatwoot_conversation_id) {
                    try {
                      await createConversationMessage(
                        cv.chatwoot_conversation_id as number,
                        {
                          content:
                            `🎙️ *Áudio transcrito (disparou tabela de preço automática):*\n\n"${
                              transcricao.slice(0, 400)
                            }"`,
                          messageType: "outgoing",
                          private: true,
                        },
                        acct,
                      );
                    } catch { /* nota é bônus */ }
                  }
                }
              }
            } else if (isVideoIntent(intentText)) {
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (
                await claimDelivery(
                  db,
                  `intent-video-${channel.id}-${from}-${intentKey}`,
                  "intent",
                )
              ) {
                await handleVideoSequence(db, channel as Json, from, acct);
                if (transcricao) {
                  const { data: ct2 } = await db.from("contacts").select("id")
                    .eq("channel_id", channel.id).eq(
                      "external_contact_id",
                      from,
                    ).maybeSingle();
                  const { data: cv2 } = ct2
                    ? await db.from("conversations").select(
                      "chatwoot_conversation_id",
                    ).eq("contact_id", ct2.id).neq("status", "resolved").order(
                      "opened_at",
                      { ascending: false },
                    ).limit(1).maybeSingle()
                    : { data: null };
                  if (cv2?.chatwoot_conversation_id) {
                    try {
                      await createConversationMessage(
                        cv2.chatwoot_conversation_id as number,
                        {
                          content:
                            `🎙️ *Áudio transcrito (disparou sequência de vídeos automática):*\n\n"${
                              transcricao.slice(0, 400)
                            }"`,
                          messageType: "outgoing",
                          private: true,
                        },
                        acct,
                      );
                    } catch { /* nota é bônus */ }
                  }
                }
              }
            } else if (isPlantioIntent(intentText)) {
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (
                await claimDelivery(
                  db,
                  `intent-plantio-${channel.id}-${from}-${intentKey}`,
                  "intent",
                )
              ) {
                await handlePlantioSequence(db, channel as Json, from, acct);
              }
            } else if (isNutricaoIntent(intentText)) {
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (
                await claimDelivery(
                  db,
                  `intent-nutricao-${channel.id}-${from}-${intentKey}`,
                  "intent",
                )
              ) {
                await handleNutricaoSequence(db, channel as Json, from, acct);
              }
            } else if (commercialIntent === "duvida_tecnica") {
              // Pergunta técnica (espaçamento, densidade, irrigação, que animal come):
              // não existe resposta pronta e chutar sobre plantio queima a confiança de
              // quem entende de terra. Então o bot cala e chama gente — que é melhor que
              // o que acontecia antes, que era a pergunta sumir e o roteiro seguir
              // falando de tonelada.
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (
                await claimDelivery(
                  db,
                  `intent-duvida-${channel.id}-${from}-${intentKey}`,
                  "intent",
                )
              ) {
                await avisarDuvidaTecnica(
                  db,
                  channel as Json,
                  from,
                  transcricao ?? intentText,
                  Boolean(transcricao),
                  acct,
                  String(m.id ?? m.message_id ?? "") || undefined,
                );
              }
            } else if (commercialIntent === "uso") {
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (await claimDelivery(db, `intent-uso-${channel.id}-${from}-${intentKey}`, "intent")) {
                const detectedUse = intentText.match(/silagem|ensilagem|silo/i)
                  ? "uso_silagem"
                  : intentText.match(/pastejo|pasto|pastoreio|pastorear/i)
                  ? "uso_pastejo"
                  : "uso_outro";
                await handleUsoSelecionado(
                  db,
                  channel as Json,
                  from,
                  detectedUse,
                  undefined,
                  acct,
                  String(m.id ?? m.message_id ?? "") || undefined,
                );
              }
            } else if (commercialIntent === "interesse_geral") {
              const intentKey = (m.id as string) ?? (m.message_id as string) ??
                new Date().toISOString();
              if (await claimDelivery(db, `intent-interesse-${channel.id}-${from}-${intentKey}`, "intent")) {
                await handleMenuClick(
                  db,
                  channel as Json,
                  from,
                  "menu_uso",
                  acct,
                  String(m.id ?? m.message_id ?? "") || undefined,
                );
              }
            } else if (isAreaAcimaDosPacotes(intentText)) {
              const hectares = extrairAreaHectares(intentText);
              if (hectares !== null) {
                const origem = channel.type === "facebook" || channel.type === "instagram"
                  ? "social"
                  : "whatsapp";
                await handleHumanRequest(db, channel as Json, from, origem, acct, {
                  tipo_pedido: "cotacao_area_livre",
                  area_hectares: hectares,
                  uso: usoPorResposta(intentText),
                  regiao_uf: extrairUF(intentText),
                  message_id: String(m.id ?? m.message_id ?? "") || null,
                });
              }
            }

            // Pergunta de anúncio sem resposta automática: aciona uma única vez o caminho
            // de atendimento humano já existente. O texto inbound já está no Chatwoot.
            if (adEnrollment?.humanHandoff) {
              const inboundMessageId = String(m.id ?? m.message_id ?? "") || null;
              const handoffClaimId = inboundMessageId
                ? `ad-question-handoff-${channel.id}-${from}-${inboundMessageId}`
                : null;
              const claimed = await claimDelivery(
                db,
                handoffClaimId,
                "ad-question-handoff",
              );
              if (claimed) {
                try {
                  await handleMenuClick(
                    db,
                    channel as Json,
                    from,
                    "menu_humano",
                    acct,
                    inboundMessageId ?? undefined,
                  );
                } catch (error) {
                  await releaseDelivery(db, handoffClaimId);
                  throw error;
                }
              }
            }
          } catch (e) {
            console.error("intent erro:", e);
          }
        }
      }
    }
  }
}

/** Etiqueta da fila de revisão de venda. Persistente: sai quando o humano decide. */
export const REVISAR_VENDA_LABEL = "revisar-venda";

/**
 * Põe a conversa na fila de "confirmar se virou venda".
 *
 * Por que etiqueta e não só nota privada: a nota vira mais uma linha no meio da conversa e
 * só é vista por quem abre aquela conversa. Etiqueta é filtrável — o Cícero abre a lista
 * por `revisar-venda` e vê todas de uma vez. Sem isso, 26 conversas com sinal claro de
 * fechamento (CEP, CPF, comprovante) ficaram `open` sem revisão — e conversa sem desfecho
 * não aparece em relatório nenhum, então venda registrada e venda esquecida são
 * indistinguíveis.
 *
 * Não decide a venda: `won` continua vindo da etiqueta `pago`, decisão humana. Marcar
 * automaticamente cancelaria o funil de quem ainda está no meio da compra.
 */
async function marcarRevisarVenda(
  cwConvId: number,
  acct: CwAcct | undefined,
): Promise<void> {
  try {
    const atuais = await getConversationLabels(cwConvId, acct);
    if (atuais.includes(REVISAR_VENDA_LABEL)) return; // já está na fila
    await setConversationLabels(
      cwConvId,
      [...atuais, REVISAR_VENDA_LABEL],
      acct,
    );
  } catch (e) {
    // Etiqueta é o canal de revisão, não o fechamento em si — falhar aqui não pode
    // derrubar a pausa do funil nem a atribuição, que são o que protege a venda.
    console.warn("revisar-venda: etiqueta falhou:", String(e).slice(0, 120));
  }
}

/**
 * Dúvida técnica: pausa o roteiro, avisa e entrega a conversa pra um humano.
 *
 * Não manda nada pro cliente de propósito — o conteúdo dessas respostas ainda não existe,
 * e resposta errada sobre espaçamento ou densidade de semente custa mais que o silêncio.
 * O ganho aqui é a pergunta parar de sumir: hoje ela chega digitada, não casa com nenhum
 * detector, e o funil segue para a próxima peça como se nada tivesse sido perguntado.
 *
 * Mesmo desenho do fluxo de fechamento logo acima (pausa + atribui + nota privada), que já
 * é o caminho conhecido do atendente.
 */
async function avisarDuvidaTecnica(
  db: Db,
  channel: Json,
  from: string,
  pergunta: string,
  veioDeAudio: boolean,
  acct: CwAcct | undefined,
  messageId?: string,
): Promise<void> {
  const origem = channel.type === "facebook" || channel.type === "instagram"
    ? "social"
    : "whatsapp";
  await handleHumanRequest(db, channel, from, origem, acct, {
    tipo_pedido: "duvida_tecnica",
    veio_de_audio: veioDeAudio,
    pergunta: pergunta.slice(0, 400),
    message_id: messageId ?? null,
  });
}

// Extrai o id+título da opção clicada (botão ou item de lista) de uma msg interactive.
function interactiveReplyId(m: Json): { id: string; title: string } | null {
  const interactive = m.interactive as Json | undefined;
  const br = interactive?.button_reply as Json | undefined;
  if (br?.id) {
    return {
      id: br.id as string,
      title: (br.title as string) ?? (br.id as string),
    };
  }
  const lr = interactive?.list_reply as Json | undefined;
  if (lr?.id) {
    return {
      id: lr.id as string,
      title: (lr.title as string) ?? (lr.id as string),
    };
  }
  return null;
}

// Conteúdo de fallback do menu de ação; preço sempre segue para cotação por pacote.
const MENU_CONTENT: Record<string, string> = {
  menu_preco:
    "🚚 Frete grátis e descontos progressivos conforme a quantidade — que podem chegar a 30% em pedidos acima de 100 kg. Escolha o pacote e o Cícero confirma o valor exato para o seu pedido.",
  menu_plantio:
    "🌱 Em breve te mando o passo a passo completo de plantio (época, adubação, espaçamento). Qualquer dúvida me chama aqui! — Cícero",
  menu_nutricao:
    "🧪 Análise bromatológica do Mega Sorgo — dados do Laboratório Prado.",
  menu_depoimento:
    "🎬 Em breve te mando os vídeos de quem já plantou e aprovou! Qualquer dúvida me chama aqui! — Cícero",
  menu_humano: "🧑‍🌾 Já te conectei com o Cícero, ele te chama em breve!",
};

// O bot identifica pacote/área, mas não expõe preço: o valor exato depende da quantidade
// negociada. O Cícero confirma a cotação após o cliente solicitar atendimento.
function cotacaoCard(pacote: string, cobre: string): string {
  return `🌱 *Opção de ${pacote} — atende ${cobre}*\n\n🚚 *Frete grátis.*\n💸 Desconto progressivo conforme a quantidade, podendo chegar a *30% em pedidos acima de 100 kg*.\n\nO Cícero confirma o valor exato para o seu pedido.`;
}

function tamanhoCard(id: string): string | null {
  switch (id) {
    case "tam_2kg":
      return cotacaoCard("2 kg", "até ½ hectare");
    case "tam_4kg":
      return cotacaoCard("4 kg", "até 1 hectare");
    case "tam_10kg":
      return cotacaoCard("10 kg", "até 2 hectares");
    case "tam_20kg":
      return cotacaoCard("20 kg", "até 4 hectares");
    case "tam_mais20kg":
      return cotacaoCard("acima de 20 kg", "área sob consulta");
    default:
      return null;
  }
}

function tamanhoLabel(id: string): string {
  switch (id) {
    case "tam_2kg":
      return "2 kg (até ½ hectare)";
    case "tam_4kg":
      return "4 kg (1 hectare)";
    case "tam_10kg":
      return "10 kg (2 hectares)";
    case "tam_20kg":
      return "20 kg (4 hectares)";
    case "tam_mais20kg":
      return "acima de 20 kg / 4 hectares";
    default:
      return id;
  }
}

const PRECO_MEDIA_POR_PACOTE: Record<
  string,
  { slot: string; arquivo: string }
> = {
  // 2 kg continua sendo uma opção de teste; não aparece no seletor padrão.
  tam_2kg: {
    slot: "preco_2kg",
    arquivo: "v2-teste-meio-hectare-2kg.jpg",
  },
  tam_4kg: { slot: "preco_4kg", arquivo: "v2-ate-1ha-4kg.jpg" },
  tam_10kg: { slot: "preco_10kg", arquivo: "v2-2ha-10kg.jpg" },
  tam_20kg: { slot: "preco_20kg", arquivo: "v2-4ha-20kg.jpg" },
};

async function imagemDoPacotePreco(db: Db, id: string): Promise<string | null> {
  const asset = PRECO_MEDIA_POR_PACOTE[id];
  if (!asset) return null;

  const { data, error } = await db.from("funnel_media").select("url,type")
    .eq("funnel", "mega-sorgo")
    .eq("day", 0)
    .eq("slot", asset.slot)
    .eq("type", "image")
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("imagem do pacote indisponível:", asset.slot, error.message);
    return null;
  }

  const url = String(data?.url ?? "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const storageOrigin = new URL(env("SUPABASE_URL")).origin;
    const expectedPath =
      `/storage/v1/object/public/soberano-out/mega-sorgo/imagens/funil-comercial-2026-10-06/${asset.arquivo}`;
    if (
      parsed.protocol !== "https:" || parsed.origin !== storageOrigin ||
      !parsed.pathname.endsWith(expectedPath)
    ) return null;
  } catch {
    return null;
  }
  return url;
}

async function handlePrecoSequence(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  if (channel.type === "facebook" || channel.type === "instagram") {
    await handleSocialPrecoSequence(db, channel, from);
    return;
  }
  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) {
    throw new Error(
      "canal sem channel_token ou phone_number_id para enviar preço",
    );
  }
  const path = `${phone}/messages`;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Apresenta primeiro as três artes padrão. A opção de 2 kg é reservada para teste.
  const pecas: {
    body: Json;
    registro: string;
    tipo: string;
    pacote?: string;
  }[] = [];
  for (const id of ["tam_4kg", "tam_10kg", "tam_20kg"]) {
    const imageUrl = await imagemDoPacotePreco(db, id);
    const caption = tamanhoCard(id);
    if (!imageUrl || !caption) continue;
    pecas.push({
      tipo: "image",
      body: { type: "image", image: { link: imageUrl, caption } },
      registro: caption,
      pacote: id,
    });
  }

  // O preço não pode ser comparado sem volume: abrir diretamente a seleção de área.
  // Lista aberta: área e pacote correspondente nos três tamanhos aprovados.
  pecas.push({
    tipo: "interactive",
    body: {
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: `📐 *Qual área você pretende plantar?*\n\n${textoCondicaoComercial()}\n\nPara áreas acima de 4 hectares, informe a área real na conversa para o Cícero calcular o volume.`,
        },
        action: {
          button: "Escolher pacote",
          sections: [{
            title: "Pacotes e volumes",
            rows: [
              {
                id: "tam_4kg",
                title: "1 hectare",
                description: "4 kg; frete grátis; valor confirmado pelo Cícero.",
              },
              {
                id: "tam_10kg",
                title: "2 hectares",
                description: "10 kg; frete grátis; valor confirmado pelo Cícero.",
              },
              {
                id: "tam_20kg",
                title: "4 hectares",
                description: "20 kg; frete grátis; valor confirmado pelo Cícero.",
              },
            ],
          }],
        },
      },
    },
    registro: "📐 Selecione a área [1 ha → 4 kg / 2 ha → 10 kg / 4 ha → 20 kg] para pedir cotação",
  });

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  for (const [i, p] of pecas.entries()) {
    if (p.tipo === "image") {
      const sent = await sendWhatsAppPiece(
        db,
        channel,
        from,
        p.body,
        p.registro,
        "image",
        acct,
      );
      if (!sent) {
        console.warn("imagem do pacote de preço não enviada:", p.pacote);
      }
      if (i < pecas.length - 1) await pause(2500);
      continue;
    }

    const r = await sendMeta(token, path, {
      messaging_product: "whatsapp",
      to: from,
      ...p.body,
    });
    const metaId = (r.data as Json)?.messages
      ? (((r.data as Json).messages as Json[])[0]?.id as string)
      : null;
    // chatwoot_message_id no insert é OBRIGATÓRIO: sem ele o pull-loop sync-chatwoot-out acha a
    // msg "órfã" no Chatwoot e reenvia como texto (duplicação vista no teste v3).
    let cwMsgId: number | null = null;
    if (r.ok && metaId && conv?.chatwoot_conversation_id) {
      try {
        const cw = await createConversationMessage(
          conv.chatwoot_conversation_id as number,
          { content: p.registro, messageType: "outgoing" },
          acct,
        );
        cwMsgId = (cw?.id as number) ?? null;
      } catch { /* registro é bônus */ }
    }
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null,
      channel_id: channel.id,
      direction: "out",
      msg_type: p.tipo === "image"
        ? "image"
        : (p.tipo === "interactive" ? "interactive" : "text"),
      content: p.registro,
      meta_message_id: metaId,
      chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed",
      sent_at: new Date().toISOString(),
    });
    // A imagem promocional é opcional, mas o CTA interativo é a entrega que confirma
    // o comando. Sem aceite + message_id da Meta, a macro deve permanecer pendente.
    if (p.tipo === "interactive" && (!r.ok || !metaId)) {
      const detail = JSON.stringify(r.data).slice(0, 300);
      throw new Error(
        `Meta não confirmou CTA de preço (${r.status}): ${detail}`,
      );
    }
    if (i < pecas.length - 1) await pause(2500);
  }
}

async function handleSocialPrecoSequence(
  db: Db,
  channel: Json,
  from: string,
): Promise<void> {
  for (const id of ["tam_4kg", "tam_10kg", "tam_20kg"]) {
    const imageUrl = await imagemDoPacotePreco(db, id);
    const caption = tamanhoCard(id);
    if (!imageUrl || !caption) continue;
    try {
      await sendSocialPieces(db, channel, from, [{
        type: "image",
        payload: { media_url: imageUrl, caption },
      }]);
    } catch (error) {
      // A imagem é complementar; uma falha não deve impedir o envio do seletor.
      console.warn("imagem do pacote social não enviada:", id, String(error).slice(0, 120));
    }
  }

  const pieces: { type: string; payload: Json }[] = [{
    type: "interactive",
    payload: {
      text: `📐 Qual área você pretende plantar? 1 hectare = 4 kg, 2 hectares = 10 kg e 4 hectares = 20 kg. ${textoCondicaoComercial()} Para áreas acima de 4 hectares, informe a área na conversa para calcularmos o volume.`,
      buttons: [
        { id: "tam_4kg", title: "1 hectare" },
        { id: "tam_10kg", title: "2 hectares" },
        { id: "tam_20kg", title: "4 hectares" },
      ],
    },
  }];

  await sendSocialPieces(db, channel, from, pieces);
}

async function recordCommercialEvent(
  db: Db,
  channel: Json,
  conversationId: string | null,
  eventType: string,
  details: Record<string, unknown> = {},
  attribution: {
    origin?: "automatico" | "humano" | "cliente";
    messageId?: string | null;
  } = {},
): Promise<void> {
  try {
    await registrarEventoComercial(db, {
      channelId: String(channel.id),
      conversationId,
      eventType,
      origin: attribution.origin ?? "automatico",
      messageId: attribution.messageId,
      details,
    });
  } catch (error) {
    // Telemetria não deve impedir uma resposta ao cliente; a decisão de mídia, por outro
    // lado, só acontece depois de uma leitura sem erro do slot explícito.
    console.warn("sales-funnel event:", eventType, String(error).slice(0, 140));
  }
}

export async function recordInboundCommercialIntent(
  db: Db,
  channel: Json,
  from: string,
  intent: string,
  messageId?: string | null,
): Promise<void> {
  if (messageId) {
    try {
      const claimed = await claimDelivery(
        db,
        `commercial-intent-${channel.id}-${messageId}-${intent}`,
        "sales-funnel-intent",
      );
      if (!claimed) return;
    } catch (error) {
      console.warn("sales-funnel intent claim:", String(error).slice(0, 120));
      return;
    }
  }
  try {
    const conversation = await resolveSocialConversation(db, channel, from);
    await recordCommercialEvent(
      db,
      channel,
      (conversation?.id as string | undefined) ?? null,
      "intencao_identificada",
      { intent },
      { origin: "cliente", messageId: messageId ?? null },
    );
  } catch (error) {
    console.warn("sales-funnel intent event:", String(error).slice(0, 120));
  }
}

function extrairUF(text: string): string | null {
  const match = text.toUpperCase().match(
    /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/,
  );
  return match?.[1] ?? null;
}

async function inferSocialReplyFromRecentPrompt(
  db: Db,
  channelId: string,
  externalContactId: string,
  reply: string,
  replyAt?: string,
): Promise<string | null> {
  const { data: contact, error: contactError } = await db.from("contacts")
    .select("id").eq("channel_id", channelId)
    .eq("external_contact_id", externalContactId).maybeSingle();
  if (contactError || !contact?.id) return null;
  const { data: conversation, error: conversationError } = await db
    .from("conversations").select("id")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (conversationError || !conversation?.id) return null;
  let query = db.from("messages").select("content,sent_at")
    .eq("conversation_id", conversation.id).eq("direction", "out")
    .eq("msg_type", "interactive")
    .order("sent_at", { ascending: false }).limit(10);
  if (replyAt) query = query.lte("sent_at", replyAt);
  const { data: prompts, error: promptError } = await query;
  if (promptError) return null;
  const at = Date.parse(replyAt ?? new Date().toISOString());
  const validPrompts = (prompts ?? []).filter((prompt: Json) => {
    const promptAt = Date.parse(String(prompt.sent_at ?? ""));
    return prompt.content && Number.isFinite(promptAt) && at >= promptAt &&
      at - promptAt <= 24 * 60 * 60_000;
  }).map((prompt: Json) => String(prompt.content));
  return inferSocialPriceReplyFromPrompts(reply, validPrompts);
}

async function sendWhatsAppPiece(
  db: Db,
  channel: Json,
  from: string,
  body: Json,
  content: string,
  msgType: string,
  acct?: CwAcct,
): Promise<boolean> {
  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return false;
  const response = await sendMeta(token, `${phone}/messages`, {
    messaging_product: "whatsapp",
    to: from,
    ...body,
  });
  const metaId = (response.data as Json)?.messages
    ? (((response.data as Json).messages as Json[])[0]?.id as string)
    : null;
  if (!response.ok || !metaId) return false;

  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from)
    .maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  let chatwootMessageId: number | null = null;
  if (conv?.chatwoot_conversation_id) {
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content, messageType: "outgoing" },
        acct,
      );
      chatwootMessageId = (cw?.id as number) ?? null;
    } catch (error) {
      console.warn("commercial message Chatwoot:", String(error).slice(0, 120));
    }
  }
  const { error } = await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: msgType,
    content,
    meta_message_id: metaId,
    chatwoot_message_id: chatwootMessageId,
    status: "sent",
    sent_at: new Date().toISOString(),
  });
  if (error) console.warn("commercial message log:", String(error).slice(0, 120));
  return true;
}

async function handleUsoQuestion(
  db: Db,
  channel: Json,
  from: string,
  actionScope?: string,
  acct?: CwAcct,
): Promise<void> {
  const buttons = OPCOES_DE_USO.map((option) => ({
    id: option.id,
    title: option.title,
  }));
  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from)
    .maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  if (channel.type === "facebook" || channel.type === "instagram") {
    await sendSocialPieces(db, channel, from, [{
      type: "interactive",
      payload: { text: textoPerguntaUso(), buttons },
    }], actionScope);
  } else {
    const replies = buttons.map((button) => ({
      type: "reply",
      reply: { id: button.id, title: button.title },
    }));
    const sent = await sendWhatsAppPiece(
      db,
      channel,
      from,
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: textoPerguntaUso() },
          action: { buttons: replies },
        },
      },
      `${textoPerguntaUso()} [Silagem / Pastejo / Outro uso]`,
      "interactive",
      acct,
    );
    if (!sent) throw new Error("Meta não confirmou pergunta de uso");
  }
  await recordCommercialEvent(
    db,
    channel,
    (conv?.id as string | undefined) ?? null,
    "pergunta_uso_enviada",
  );
}

async function handleUsoSelecionado(
  db: Db,
  channel: Json,
  from: string,
  actionId: string,
  actionScope?: string,
  acct?: CwAcct,
  eventMessageId?: string,
): Promise<void> {
  const use = usoPorResposta(actionId);
  if (!use) return;
  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from)
    .maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  await recordCommercialEvent(
    db,
    channel,
    (conv?.id as string | undefined) ?? null,
    "uso_informado",
    { uso: use },
    { origin: "cliente", messageId: eventMessageId ?? null },
  );

  // Só slots dedicados, revisados por finalidade, podem ser prova. O catálogo não tem um
  // campo de aprovação; nomes explícitos + ativo + URL segura + legenda impedem cair na
  // seleção genérica de vídeo que já provocou rajadas repetidas.
  const proofSlot = `prova_${use}_aprovada`;
  const proofResult = await db.from("funnel_media").select("url,caption,type")
    .eq("funnel", "mega-sorgo").eq("slot", proofSlot).eq("active", true)
    .limit(1).maybeSingle();
  const proof = !proofResult.error && proofResult.data
    ? proofResult.data as Json
    : null;
  const url = String(proof?.url ?? "");
  const caption = String(proof?.caption ?? "").trim();
  const mediaType = String(proof?.type ?? "").toLowerCase();
  let proofSent = false;
  if (
    /^https:\/\//i.test(url) && caption &&
    (mediaType === "image" || mediaType === "video")
  ) {
    if (channel.type === "facebook" || channel.type === "instagram") {
      await sendSocialPieces(db, channel, from, [{
        type: mediaType,
        payload: { media_url: url, caption },
      }], actionScope ? `${actionScope}:proof` : undefined);
      proofSent = true;
    } else {
      const body = mediaType === "image"
        ? { type: "image", image: { link: url, caption } }
        : { type: "video", video: { link: url, caption } };
      proofSent = await sendWhatsAppPiece(
        db,
        channel,
        from,
        body,
        `[prova ${use}] ${caption}`,
        mediaType,
        acct,
      );
    }
  }
  if (proofSent) {
    await recordCommercialEvent(
      db,
      channel,
      (conv?.id as string | undefined) ?? null,
      "prova_enviada",
      { uso: use, slot: proofSlot, media_type: mediaType },
      { origin: "automatico", messageId: eventMessageId ?? null },
    );
  } else if (proofResult.error) {
    console.warn("prova comercial indisponível:", String(proofResult.error).slice(0, 120));
  }

  if (!proofSent) {
    const useText = use === "silagem" ? "silagem" : use === "pastejo" ? "pastejo" : "essa finalidade";
    const text = `Entendi: o senhor pretende usar para ${useText}. Vou te mostrar as opções de área e volume.`;
    if (channel.type === "facebook" || channel.type === "instagram") {
      await sendSocialPieces(db, channel, from, [{ type: "text", payload: { content: text } }], actionScope ? `${actionScope}:context` : undefined);
    } else {
      await sendWhatsAppPiece(db, channel, from, { type: "text", text: { body: text } }, text, "text", acct);
    }
  }
  if (channel.type === "facebook" || channel.type === "instagram") {
    await handleSocialPrecoSequence(db, channel, from);
  } else {
    await handlePrecoSequence(db, channel, from, acct);
  }
}

async function sendSocialPieces(
  db: Db,
  channel: Json,
  from: string,
  pieces: { type: string; payload: Json }[],
  dedupeScope?: string,
): Promise<void> {
  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("chatwoot_conversation_id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const cwConvId = Number(conv?.chatwoot_conversation_id);
  if (!cwConvId) {
    throw new Error("conversa privada não encontrada para enviar funil");
  }

  for (const piece of pieces) {
    const response = await sendOutbound(
      new Request(
        `http://internal/send-outbound?token=${
          encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))
        }`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatwoot_conversation_id: cwConvId,
            type: piece.type,
            payload: piece.payload,
            dedupe_scope: dedupeScope,
          }),
        },
      ),
    );
    const result = await response.json().catch(() => ({})) as Json;
    if (!response.ok || result.ok === false || result.blocked) {
      throw new Error(
        result.error
          ? metaErrorDetail(result)
          : String(result.blocked ?? `envio ${response.status}`),
      );
    }
  }
}

export async function handleSocialPrecoClick(
  db: Db,
  channel: Json,
  from: string,
  id: string,
  actionEventId?: string,
): Promise<void> {
  const actionScope = actionEventId
    ? `social-price-action:${actionEventId}`
    : undefined;
  if (id.startsWith("uso_")) {
    await handleUsoSelecionado(db, channel, from, id, actionScope, undefined, actionEventId);
    return;
  }
  if (id.startsWith("preco_area_livre:")) {
    const hectares = Number(id.slice("preco_area_livre:".length));
    if (Number.isFinite(hectares) && hectares > 4) {
      await handleHumanRequest(db, channel, from, "social", undefined, {
        tipo_pedido: "cotacao_area_livre",
        area_hectares: hectares,
        regiao_uf: null,
        message_id: actionEventId ?? null,
      });
    }
    return;
  }
  if (id === "preco_tamanho") {
    await sendSocialPieces(db, channel, from, [{
      type: "interactive",
      payload: {
        text: "📐 Escolha a área: 1 hectare = 4 kg, 2 hectares = 10 kg ou 4 hectares = 20 kg.",
        buttons: [
          { id: "tam_4kg", title: "1 hectare" },
          { id: "tam_10kg", title: "2 hectares" },
          { id: "tam_20kg", title: "4 hectares" },
        ],
      },
    }], actionScope);
    return;
  }
  if (id === "preco_area_maior") {
    await sendSocialPieces(db, channel, from, [{
      type: "text",
      payload: {
        content: "Para áreas acima de 4 hectares, diga quantos hectares pretende plantar e sua região (município/UF). O Cícero confirma o volume e a cotação exata.",
      },
    }], actionScope);
    return;
  }
  if (id.startsWith("preco_cotar_")) {
    const selectedPackage = id.slice("preco_cotar_".length);
    const pacote = pacotePorId(selectedPackage);
    const packageLabel = tamanhoLabel(selectedPackage);
    const conversation = await resolveSocialConversation(db, channel, from);
    const pedido = await registrarPedidoHumano(db, {
      conversationId: (conversation?.id as string | undefined) ?? null,
      channelId: String(channel.id),
      chatwootConversationId:
        (conversation?.chatwoot_conversation_id as number | undefined) ?? null,
      origem: "social",
      contato: from,
      contexto: {
        tipo_pedido: "cotacao",
        pacote_id: pacote?.id ?? selectedPackage,
        pacote_kg: pacote?.quilos ?? null,
        area_hectares: pacote?.area ?? null,
        regiao_uf: null,
      },
    });
    const text = pedido.registrado
      ? `✅ Seu pedido de cotação de ${packageLabel} foi registrado para atendimento. O valor será confirmado conforme quantidade e região. ${textoCondicaoComercial()}`
      : "Não consegui confirmar o registro automático da cotação agora. Envie sua região nesta conversa e a equipe poderá conferir o pedido; não vou informar preço sem confirmar o pacote e o frete.";
    await recordCommercialEvent(db, channel, (conversation?.id as string | undefined) ?? null, "cotacao_solicitada", {
      pacote_id: pacote?.id ?? selectedPackage,
      pacote_kg: pacote?.quilos ?? null,
      area_hectares: pacote?.area ?? null,
      encaminhado: pedido.registrado,
    }, { origin: "cliente", messageId: actionEventId ?? null });
    await sendSocialPieces(db, channel, from, [{
      type: "text",
      payload: { content: text },
    }], actionScope);
    const assignee = Number(optionalEnv("CHATWOOT_ASSIGNEE_ID") ?? "0");
    if (pedido.registrado && assignee > 0 && conversation?.chatwoot_conversation_id) {
      const acct = await accountForChannel(channel.id as string);
      await assignConversation(
        conversation.chatwoot_conversation_id as number,
        assignee,
        acct,
      );
    }
    if (pedido.registrado) {
      await markSocialLead(
        db,
        channel,
        from,
        ["lead-quente"],
        `Cliente pediu cotação do pacote ${packageLabel}. Confirmar preço para a quantidade e região; não enviar tabela geral.`,
      );
    }
    return;
  }
  if (id === "preco_pagamento") {
    await sendSocialPieces(db, channel, from, [{
      type: "interactive",
      payload: {
        text: "💳 Como o senhor prefere pagar?",
        buttons: [
          { id: "pag_pix", title: "PIX" },
          { id: "pag_cartao", title: "Cartão" },
          { id: "pag_boleto", title: "Boleto" },
        ],
      },
    }], actionScope);
    return;
  }

  const paymentText: Record<string, string> = {
    pag_pix:
      "💰 PIX direto com a empresa, no CNPJ. O Cícero vai enviar a chave para concluir o pedido.",
    pag_cartao:
      "💳 O Cícero vai enviar o link de pagamento pelo site. Antes de confirmar, confira no checkout as condições e quais proteções se aplicam à sua compra.",
    pag_boleto:
      "📄 O Cícero vai enviar o link para gerar o boleto. O checkout informa o prazo de confirmação e as condições aplicáveis.",
    preco_comprar:
      "🤝 Fechado! O Cícero vai chamar em instantes para concluir o pedido.",
  };
  if (paymentText[id]) {
    await sendSocialPieces(db, channel, from, [{
      type: "text",
      payload: { content: paymentText[id] },
    }], actionScope);
    if (id === "preco_comprar") {
      await markSocialLead(
        db,
        channel,
        from,
        [
          "lead-quente",
          "qualificado",
          "fechamento-pendente",
        ],
        "Cliente clicou em Quero garantir. Prioridade máxima para concluir o pedido.",
      );
    }
    return;
  }

  const card = tamanhoCard(id);
  if (!card) return;
  const imageUrl = await imagemDoPacotePreco(db, id);
  const pieces: { type: string; payload: Json }[] = [];
  pieces.push(
    imageUrl
      ? { type: "image", payload: { media_url: imageUrl, caption: card } }
      : { type: "text", payload: { content: card } },
    {
      type: "interactive",
      payload: {
        text: "Quer que o Cícero confirme o valor exato deste pacote?",
        buttons: [
          { id: `preco_cotar_${id}`, title: "Pedir cotação" },
          { id: "preco_tamanho", title: "Outro pacote" },
        ],
      },
    },
  );
  await sendSocialPieces(
    db,
    channel,
    from,
    pieces,
    actionScope ? `${actionScope}:package:${id}` : undefined,
  );
}

async function resolveSocialConversation(db: Db, channel: Json, from: string) {
  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id")
      .eq("contact_id", contact.id).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  return conv as Json | null;
}

async function markSocialLead(
  db: Db,
  channel: Json,
  from: string,
  addedLabels: string[],
  note: string,
): Promise<void> {
  const conv = await resolveSocialConversation(db, channel, from);
  const cwConvId = Number(conv?.chatwoot_conversation_id);
  if (!cwConvId) return;
  const acct = await accountForChannel(channel.id as string);
  try {
    const labels = await getConversationLabels(cwConvId, acct);
    const sourceLabel = channel.type === "facebook"
      ? "canal-facebook"
      : channel.type === "instagram"
      ? "canal-instagram"
      : null;
    await setConversationLabels(
      cwConvId,
      [
        ...new Set([
          ...labels,
          ...addedLabels,
          ...(sourceLabel ? [sourceLabel] : []),
        ]),
      ],
      acct,
    );
    await createConversationMessage(cwConvId, {
      content: `${
        addedLabels.includes("lead-quente")
          ? "🔥 *LEAD QUENTE*"
          : "📥 *NOVO LEAD*"
      } — ${note}`,
      messageType: "outgoing",
      private: true,
    }, acct);
  } catch (error) {
    console.warn("qualificação social falhou:", String(error).slice(0, 180));
  }
  await db.from("events").insert({
    source: "social-sales",
    event_type: "lead_qualified",
    channel_id: channel.id,
    payload: {
      conversation_id: conv?.id ?? null,
      chatwoot_conversation_id: cwConvId,
      external_contact_id: from,
      labels: addedLabels,
      note,
    },
  });
}

export async function handleSocialSalesIntent(
  db: Db,
  channel: Json,
  from: string,
  text: string,
  messageId: string,
  forcedIntent?: SocialSalesIntent,
): Promise<boolean> {
  const intent = forcedIntent ?? inferSocialSalesIntent(text);
  if (!intent) return false;
  const claimed = await claimDelivery(
    db,
    socialSalesClaimKey(channel.id as string, messageId, intent),
    "social-sales",
  );
  if (!claimed) return true;

  try {
    if (intent === "contact") {
      const whatsappUrl = salesWhatsAppUrl();
      const { data: media } = await db.from("funnel_media").select("url")
        .eq("funnel", "mega-sorgo").eq("active", true)
        .like("url", "%/campo.png").limit(1).maybeSingle();
      await sendSocialPieces(db, channel, from, [{
        type: "interactive",
        payload: {
          card_title: "Fale com a Campo Soberano",
          header_image: media?.url ?? salesContactImageFallback(),
          text: socialContactText(whatsappUrl),
          buttons: [{
            id: "contact_whatsapp",
            title: "Chamar no WhatsApp",
            url: whatsappUrl,
          }],
        },
      }], `social-contact:${messageId}`);
      await markSocialLead(db, channel, from, [
        "lead-quente",
        "pediu-contato",
      ], "Cliente pediu contato com o Cícero. Responder o quanto antes.");
      // A etiqueta e a nota já ficavam na conversa, mas ninguém era avisado: dos 8 pedidos de
      // 09 a 13/09, nenhum tinha atendente no dia seguinte. O alerta é o que fecha o laço.
      {
        const { data: ct } = await db.from("contacts").select("id")
          .eq("channel_id", channel.id).eq("external_contact_id", from).maybeSingle();
        const { data: cv } = ct
          ? await db.from("conversations").select("id,chatwoot_conversation_id")
            .eq("contact_id", ct.id).neq("status", "resolved")
            .order("opened_at", { ascending: false }).limit(1).maybeSingle()
          : { data: null };
        if (cv?.id) {
          try {
            await autoPauseFunil(String(cv.id), "pedido_contato", {
              comPrazo: false,
            });
          } catch (error) {
            console.error("handleSocialSalesIntent pausa de funil falhou:", error);
          }
        }
        const pedido = await registrarPedidoHumano(db, {
          conversationId: (cv?.id as string | undefined) ?? null,
          channelId: String(channel.id),
          chatwootConversationId: (cv?.chatwoot_conversation_id as number | undefined) ?? null,
          origem: "social",
          contato: from,
        });
        await recordCommercialEvent(
          db,
          channel,
          (cv?.id as string | undefined) ?? null,
          "pedido_atendimento",
          { encaminhado: pedido.registrado, tipo_pedido: "atendimento" },
          { origin: "cliente", messageId },
        );
      }
    } else {
      await sendSocialPieces(db, channel, from, [{
        type: "list",
        payload: {
          text: SOCIAL_INFO_TEXT,
          sections: [{
            rows: [
              { id: "menu_preco", title: "Ver preço" },
              { id: "menu_uso", title: "Escolher finalidade" },
              { id: "menu_depoimento", title: "Ver vídeos" },
              { id: "menu_plantio", title: "Como plantar" },
              { id: "menu_nutricao", title: "Ver nutrição" },
              { id: "menu_humano", title: "Falar com Cícero" },
            ],
          }],
        },
      }], `social-info:${messageId}`);
      await markSocialLead(db, channel, from, [
        "lead-novo",
        "pediu-informacao",
      ], "Cliente pediu informações e recebeu o menu comercial inicial.");
    }
    return true;
  } catch (error) {
    await releaseDelivery(
      db,
      socialSalesClaimKey(channel.id as string, messageId, intent),
    );
    throw error;
  }
}

// clique nos botões da sequência de preço.
export async function handlePrecoClick(
  db: Db,
  channel: Json,
  from: string,
  id: string,
  acct?: CwAcct,
  _actionEventId?: string,
): Promise<void> {
  if (id.startsWith("uso_")) {
    await handleUsoSelecionado(db, channel, from, id, undefined, acct, _actionEventId);
    return;
  }
  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return;
  const path = `${phone}/messages`;

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  // registra no Chatwoot e DEVOLVE o id — o id precisa ir pro insert em messages
  // (chatwoot_message_id), senão o pull-loop sync-chatwoot-out acha a msg "órfã" no Chatwoot
  // e REENVIA como texto (causa da duplicação do card/frete vista no teste v3).
  const registra = async (
    texto: string,
    priv = false,
  ): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content: texto, messageType: "outgoing", private: priv },
        acct,
      );
      return (cw?.id as number) ?? null;
    } catch {
      return null;
    }
  };
  const envia = async (body: Json, registro: string, tipo: string) => {
    const r = await sendMeta(token, path, {
      messaging_product: "whatsapp",
      to: from,
      ...body,
    });
    const metaId = (r.data as Json)?.messages
      ? (((r.data as Json).messages as Json[])[0]?.id as string)
      : null;
    const cwMsgId = await registra(registro);
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null,
      channel_id: channel.id,
      direction: "out",
      msg_type: tipo,
      content: registro,
      meta_message_id: metaId,
      chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed",
      sent_at: new Date().toISOString(),
    });
  };

  if (id === "preco_pagamento") {
    await envia(
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "💳 *Como o senhor prefere pagar?*" },
          action: {
            buttons: [
              { type: "reply", reply: { id: "pag_pix", title: "PIX" } },
              { type: "reply", reply: { id: "pag_cartao", title: "Cartão" } },
              { type: "reply", reply: { id: "pag_boleto", title: "Boleto" } },
            ],
          },
        },
      },
      "Como prefere pagar? [PIX / Cartão / Boleto]",
      "interactive",
    );
    return;
  }

  if (id.startsWith("preco_cotar_")) {
    const selectedPackage = id.slice("preco_cotar_".length);
    const pacote = pacotePorId(selectedPackage);
    const packageLabel = tamanhoLabel(selectedPackage);
    const pedido = await registrarPedidoHumano(db, {
      conversationId: (conv?.id as string | undefined) ?? null,
      channelId: String(channel.id),
      chatwootConversationId:
        (conv?.chatwoot_conversation_id as number | undefined) ?? null,
      origem: "whatsapp",
      contato: from,
      contexto: {
        tipo_pedido: "cotacao",
        pacote_id: pacote?.id ?? selectedPackage,
        pacote_kg: pacote?.quilos ?? null,
        area_hectares: pacote?.area ?? null,
        regiao_uf: null,
      },
    });
    const text = pedido.registrado
      ? `✅ Seu pedido de cotação de ${packageLabel} foi registrado para atendimento. O valor será confirmado conforme quantidade e região. ${textoCondicaoComercial()}`
      : "Não consegui confirmar o registro automático da cotação agora. Envie sua região nesta conversa para a equipe conferir o pedido; não vou informar preço sem confirmar o pacote e o frete.";
    await recordCommercialEvent(db, channel, (conv?.id as string | undefined) ?? null, "cotacao_solicitada", {
      pacote_id: pacote?.id ?? selectedPackage,
      pacote_kg: pacote?.quilos ?? null,
      area_hectares: pacote?.area ?? null,
      encaminhado: pedido.registrado,
    }, { origin: "cliente", messageId: _actionEventId ?? null });
    await envia({ type: "text", text: { body: text } }, text, "text");
    const assignee = Number(optionalEnv("CHATWOOT_ASSIGNEE_ID") ?? "0");
    if (pedido.registrado && assignee > 0 && conv?.chatwoot_conversation_id) {
      await assignConversation(
        conv.chatwoot_conversation_id as number,
        assignee,
        acct,
      );
    }
    if (pedido.registrado) {
      await registra(
        `🔥 LEAD PEDIU COTAÇÃO do pacote ${packageLabel}. Confirmar preço para quantidade e região; não enviar tabela geral.`,
        true,
      );
    }
    return;
  }

  if (id === "preco_area_maior") {
    const text = "Para áreas acima de 4 hectares, diga quantos hectares pretende plantar e sua região (município/UF). O Cícero confirma o volume e a cotação exata.";
    await envia({ type: "text", text: { body: text } }, text, "text");
    return;
  }

  if (id === "pag_pix") {
    await envia(
      {
        type: "text",
        text: {
          body:
            "💰 *PIX direto com a empresa* (no CNPJ) — rápido, sem burocracia!\n\nO Cícero vai te enviar a chave PIX pra concluir o pedido.",
        },
      },
      "PIX direto com a empresa",
      "text",
    );
    await registra(
      "🔥 *LEAD QUENTE — escolheu PIX.* Enviar chave e fechar!",
      true,
    );
    return;
  }

  if (id === "pag_cartao") {
    await envia(
      {
        type: "text",
        text: {
          body:
            "💳 *Cartão de crédito ou débito*\n\nO Cícero vai te enviar o link do site. Antes de confirmar, confira no checkout as condições e quais proteções se aplicam à sua compra.",
        },
      },
      "Cartão de crédito/débito via Mercado Pago",
      "text",
    );
    await registra(
      "🔥 *LEAD QUENTE — escolheu Cartão.* Enviar link Mercado Pago!",
      true,
    );
    return;
  }

  if (id === "pag_boleto") {
    await envia(
      {
        type: "text",
        text: {
          body:
            "📄 *Boleto bancário*\n\nO Cícero vai te enviar o link para gerar o boleto. O checkout informa o prazo de confirmação e as condições aplicáveis.",
        },
      },
      "Boleto via Mercado Pago",
      "text",
    );
    await registra(
      "🔥 *LEAD QUENTE — escolheu Boleto.* Enviar link Mercado Pago!",
      true,
    );
    return;
  }

  if (id === "preco_comprar") {
    const texto =
      "🤝 *Fechado!* O Cícero vai te chamar em instantes pra concluir o pedido.\n\n💳 PIX direto com a empresa ou pelo site com Mercado Pago — como o senhor preferir!";
    await envia({ type: "text", text: { body: texto } }, texto, "text");

    // Atribui a conversa a um atendente. Sem isso o lead quente ficava só com etiqueta e
    // nota privada: em 03/08, 11 dos 14 que clicaram aqui nunca foram fechados porque a
    // conversa não tinha dono. A mensagem acima promete "o Cícero vai te chamar" — a
    // atribuição é o que faz essa promessa cair na fila de alguém.
    const assignee = Number(optionalEnv("CHATWOOT_ASSIGNEE_ID") ?? "0");
    let atribuido = false;
    if (assignee > 0 && conv?.chatwoot_conversation_id) {
      atribuido = await assignConversation(
        conv.chatwoot_conversation_id as number,
        assignee,
        acct,
      );
    }
    await registra(
      atribuido
        ? "🔥 *LEAD QUENTE — clicou 🛒 QUERO GARANTIR na tabela de preço.* Conversa atribuída — fechar a venda AGORA!"
        : "🔥 *LEAD QUENTE — clicou 🛒 QUERO GARANTIR na tabela de preço.* Fechar a venda AGORA!",
      true,
    );
    return;
  }

  if (id === "preco_tamanho") {
    await envia(
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: "📐 *Escolha a área:* 1 hectare = 4 kg, 2 hectares = 10 kg ou 4 hectares = 20 kg.",
          },
          action: {
            buttons: [
              { type: "reply", reply: { id: "tam_4kg", title: "1 hectare" } },
              { type: "reply", reply: { id: "tam_10kg", title: "2 hectares" } },
              { type: "reply", reply: { id: "tam_20kg", title: "4 hectares" } },
            ],
          },
        },
      },
      "📐 Selecione a área [1 ha / 2 ha / 4 ha] e o pacote correspondente",
      "interactive",
    );
    return;
  }

  if (id === "preco_area_maior") {
    await envia(
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text: "🌱 *Escolha a área:* 1 hectare = 4 kg, 2 hectares = 10 kg ou 4 hectares = 20 kg.",
          },
          action: {
            buttons: [
              { type: "reply", reply: { id: "tam_4kg", title: "1 hectare" } },
              { type: "reply", reply: { id: "tam_10kg", title: "2 hectares" } },
              { type: "reply", reply: { id: "tam_20kg", title: "4 hectares" } },
            ],
          },
        },
      },
      "Selecione a área [1 ha / 2 ha / 4 ha] e o pacote correspondente",
      "interactive",
    );
    return;
  }

  // Clique no pacote -> descrição sem preço -> cotação humana sob solicitação.
  const card = tamanhoCard(id);
  if (card) {
    const imageUrl = await imagemDoPacotePreco(db, id);
    if (imageUrl) {
      await sendSocialPieces(
        db,
        channel,
        from,
        [{ type: "image", payload: { media_url: imageUrl, caption: card } }],
        _actionEventId ? `whatsapp-price-package:${_actionEventId}` : undefined,
      );
    } else {
      await envia({ type: "text", text: { body: card } }, card, "text");
    }
    await envia(
      {
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: "Quer que o Cícero confirme o valor exato deste pacote?" },
          action: {
            buttons: [
              {
                type: "reply",
                reply: { id: `preco_cotar_${id}`, title: "Pedir cotação" },
              },
              {
                type: "reply",
                reply: { id: "preco_tamanho", title: "Outro pacote" },
              },
            ],
          },
        },
      },
      "Quer cotação exata? [Pedir cotação / Outro pacote]",
      "interactive",
    );
  }
}

// A antiga rajada de cinco vídeos foi retirada; o menu de vídeo agora pergunta o uso e
// só pode avançar para uma única mídia dedicada, se houver uma peça ativa e revisada.
export async function handleVideoSequence(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  await handleUsoQuestion(db, channel, from, undefined, acct);
}
// ── Sequência COMO PLANTAR (PDF + lista de resumos) ─────────────────────────
const PLANTIO_RESUMOS: Record<string, string> = {
  plantio_inicio: "🌱 *Como começar o plantio*\n\n" +
    "• Use *4 a 5 kg de sementes por hectare*\n" +
    "• Plante a *2 a 3 cm de profundidade*\n" +
    "• Época recomendada: *setembro a março*\n" +
    "• Em plantio a lanço, use cerca de *10% a mais de sementes*\n\n" +
    "Se me disser quantos hectares vai plantar, eu também calculo a quantidade de semente.",
  plantio_solo: "🧪 *Solo e adubação*\n\n" +
    "• Faça análise do solo antes da safra\n" +
    "• A calagem deve buscar saturação por bases de até *70%*\n" +
    "• Na semeadura: *20 a 40 kg/ha de nitrogênio*\n" +
    "• Fósforo e potássio: ajustar conforme a análise\n" +
    "• Cobertura: referência de *200 kg/ha da fórmula 20-00-20*, entre 25 e 35 dias\n\n" +
    "A recomendação final deve ser validada por um agrônomo com a análise da sua área.",
  plantio_colheita: "✂️ *Corte, silagem e produtividade*\n\n" +
    "• Primeiro corte: geralmente entre *90 e 110 dias*\n" +
    "• Corte com matéria seca entre *30% e 35%*\n" +
    "• Partículas de *1,25 a 1,75 cm*\n" +
    "• Produtividade e possibilidade de rebrote variam por material e condições de cultivo.\n" +
    "• Use dados de campo comparáveis antes de estimar produção para sua área.",
  plantio_1: "🌱 *Especificações da Semente*\n\n" +
    "• Recomendação: *5 kg por hectare*\n" +
    "• Plantio: de *setembro a março* (safra e safrinha)\n" +
    "• Proteína: *8%*\n" +
    "• Altura, tolerância a estresse e número de cortes dependem da cultivar e do manejo.\n" +
    "• Confirme as características do lote na ficha técnica do Santa Elisa.",

  plantio_2: "📏 *Espaçamento e Plantio em Linha*\n\n" +
    "• Use *4 a 5 kg/ha* (já conta 20-30% a mais pra compensar perdas)\n" +
    "• Profundidade: *2 a 3 cm* (mais raso em solo argiloso)\n" +
    "• Disco: *52 furos de 3,50 mm* (mecânica) ou *1,75 mm* (vácuo)\n" +
    "• Espaçamento maior facilita a máquina de corte na silagem\n" +
    "• População: *110.000 a 140.000* sementes por hectare",

  plantio_3: "🌾 *Plantio a Lanço*\n\n" +
    "• Coloque *10% a mais* de semente que no plantio em linha\n" +
    "• Motivo: perde mais pra pássaros e roedores\n" +
    "• ⚠️ Cuidado com chuva forte — carrega a semente\n" +
    "• O adubo vai no fundo do sulco, *mínimo 3 cm* longe da semente",

  plantio_4: "🧪 *Calagem do Solo*\n\n" +
    "• Faça análise do solo (0-20 cm) *antes* da safra\n" +
    "• Objetivo: elevar a saturação por bases (V) a *70%*\n" +
    "• Solo com bastante matéria orgânica: basta elevar V a *50%*\n" +
    "• A calagem leva *alguns meses* pra fazer efeito — não deixe pra última hora",

  plantio_5: "💊 *Adubação de Base (NPK)*\n\n" +
    "• Na semeadura: *20 a 40 kg/ha de Nitrogênio*\n" +
    "• Fósforo e Potássio: conforme análise do solo\n" +
    "• Solo fraco: mais adubo. Solo bom: menos adubo\n" +
    "• Potássio no sulco ou a lanço antes do plantio, conforme recomendação técnica\n" +
    "• Não use uma meta de produção sem dados de campo da sua região.",

  plantio_6: "🔄 *Adubação de Cobertura*\n\n" +
    "• Fórmula *20-00-20*: aplicar *200 kg/ha*\n" +
    "• Quando: *25 a 35 dias* após o plantio, a lanço\n" +
    "• Número de coberturas e adubação do rebrote dependem da análise do solo e do manejo\n" +
    "• Mais adubo não garante mais produção; siga a recomendação técnica para a área.",

  plantio_7: "🌿 *Controle de Daninhas (Mato)*\n\n" +
    "• Limpe a área *antes* do plantio\n" +
    "• Identifique as espécies e o estágio das plantas daninhas\n" +
    "• Use somente produto registrado para a cultura e a situação da área, conforme bula\n" +
    "• Confirme produto, dose e momento com agrônomo; não há dose única segura para toda área.",

  plantio_8: "🐛 *Pragas e Tratamento de Sementes*\n\n" +
    "• Monitore a lavoura e identifique a praga antes de decidir o controle\n" +
    "• Tratamento de sementes e pulverização dependem de diagnóstico e produto registrado\n" +
    "• Siga a bula e a orientação de um agrônomo; evite aplicação preventiva sem recomendação.",

  plantio_9: "✂️ *Ponto de Corte e Silagem*\n\n" +
    "• Corte quando a matéria seca estiver entre *30 e 35%*\n" +
    "• Primeiro corte: *90 a 110 dias* após o plantio\n" +
    "• Tamanho das partículas: *1,25 a 1,75 cm*\n" +
    "• Não espere a panícula desenvolver toda — o objetivo é *massa verde*\n" +
    "• Boa compactação + vedação = silagem de qualidade\n" +
    "• Use *inoculante* pra uma boa fermentação",

  plantio_10: "📊 *Produtividade e Rebrote*\n\n" +
    "• Rendimento e rebrote variam conforme híbrido, clima, solo, época e manejo\n" +
    "• Compare sorgo e milho com dados medidos na mesma região e base de cálculo\n" +
    "• Pode fazer *pastejo direto* — entrada dos animais com 70-80 cm de altura\n" +
    "• Use a ficha técnica e dados de campo do material para planejar sua área.",
};

const PLANTIO_DISCLAIMER =
  "ℹ️ Referências gerais: doses e calendário variam por região, cultivar e análise do solo. Confirme a ficha técnica do Santa Elisa com um agrônomo.";

async function handlePlantioSequence(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  if (channel.type === "facebook" || channel.type === "instagram") {
    await handleSocialPlantioSequence(db, channel, from);
    return;
  }
  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) {
    throw new Error("canal sem credenciais para enviar plantio");
  }
  const msgPath = `${phone}/messages`;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const registra = async (
    texto: string,
    priv = false,
  ): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content: texto, messageType: "outgoing", private: priv },
        acct,
      );
      return (cw?.id as number) ?? null;
    } catch {
      return null;
    }
  };
  const envia = async (body: Json, registro: string, tipo: string) => {
    const r = await sendMeta(token, msgPath, {
      messaging_product: "whatsapp",
      to: from,
      ...body,
    });
    const metaId = (r.data as Json)?.messages
      ? (((r.data as Json).messages as Json[])[0]?.id as string)
      : null;
    if (!r.ok || !metaId) {
      const detail = JSON.stringify(r.data).slice(0, 300);
      throw new Error(
        `Meta não confirmou item de plantio (${r.status}): ${detail}`,
      );
    }
    const cwMsgId = await registra(registro);
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null,
      channel_id: channel.id,
      direction: "out",
      msg_type: tipo,
      content: registro,
      meta_message_id: metaId,
      chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed",
      sent_at: new Date().toISOString(),
    });
  };

  // 1) PDF
  const { data: pdfMedia } = await db.from("funnel_media").select("url")
    .eq("funnel", "mega-sorgo").eq("slot", "plantio_pdf").eq("active", true)
    .limit(1).maybeSingle();
  if (pdfMedia?.url) {
    await sendFunnelDocument(db, channel, {
      to: from,
      mediaUrl: pdfMedia.url as string,
      fileName: "Instrucoes-Plantio-Mega-Sorgo.pdf",
      caption:
        "📄 *Instruções completas de plantio* — Mega Sorgo Santa Elisa",
      registro: "[PDF Instruções de Plantio]",
    }, acct);
    await pause(3000);
  }

  // 2) Três necessidades visíveis; a lista técnica completa fica como aprofundamento.
  await envia(
    {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text:
            "🌱 *O que o senhor precisa resolver agora no plantio?*\n\nToque em uma opção e eu mando a orientação direto ao ponto.",
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "plantio_inicio", title: "Como começar" },
            },
            {
              type: "reply",
              reply: { id: "plantio_solo", title: "Solo e adubação" },
            },
            {
              type: "reply",
              reply: { id: "plantio_colheita", title: "Corte e silagem" },
            },
          ],
        },
      },
    },
    "O que precisa no plantio? [Como começar / Solo e adubação / Corte e silagem]",
    "interactive",
  );
}

export async function handlePlantioClick(
  db: Db,
  channel: Json,
  from: string,
  id: string,
  acct?: CwAcct,
): Promise<void> {
  const resumoBase = PLANTIO_RESUMOS[id];
  if (!resumoBase) return;
  const resumo = `${PLANTIO_DISCLAIMER}\n\n${resumoBase}`;
  if (channel.type === "facebook" || channel.type === "instagram") {
    await sendSocialPieces(db, channel, from, [
      { type: "text", payload: { content: resumo } },
      socialPlantioListPiece(),
    ]);
    return;
  }

  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) {
    throw new Error("canal sem credenciais para responder plantio");
  }
  const msgPath = `${phone}/messages`;

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const registra = async (texto: string): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content: texto, messageType: "outgoing" },
        acct,
      );
      return (cw?.id as number) ?? null;
    } catch {
      return null;
    }
  };

  // envia resumo
  const r = await sendMeta(token, msgPath, {
    messaging_product: "whatsapp",
    to: from,
    type: "text",
    text: { body: resumo },
  });
  const metaId = (r.data as Json)?.messages
    ? (((r.data as Json).messages as Json[])[0]?.id as string)
    : null;
  if (!r.ok || !metaId) {
    const detail = JSON.stringify(r.data).slice(0, 300);
    throw new Error(
      `Meta não confirmou resumo de plantio (${r.status}): ${detail}`,
    );
  }
  const cwMsgId = await registra(resumo);
  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: "text",
    content: resumo,
    meta_message_id: metaId,
    chatwoot_message_id: cwMsgId,
    status: r.ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });

  // re-envia lista pra poder consultar outro tema
  const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));
  await pause(2000);
  const r2 = await sendMeta(token, msgPath, {
    messaging_product: "whatsapp",
    to: from,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Quer ver outro tema? 👇" },
      action: {
        button: "Ver mais temas",
        sections: [{
          title: "Temas de plantio",
          rows: [
            {
              id: "plantio_1",
              title: "🌱 A semente",
              description: "Características e especificações",
            },
            {
              id: "plantio_2",
              title: "📏 Plantio em linha",
              description: "Espaçamento, disco e profundidade",
            },
            {
              id: "plantio_3",
              title: "🌾 Plantio a lanço",
              description: "Quantidade e cuidados",
            },
            {
              id: "plantio_4",
              title: "🧪 Calagem do solo",
              description: "Preparação e correção do solo",
            },
            {
              id: "plantio_5",
              title: "💊 Adubação de base",
              description: "NPK na semeadura",
            },
            {
              id: "plantio_6",
              title: "🔄 Adubação cobertura",
              description: "Cobertura e rebrote",
            },
            {
              id: "plantio_7",
              title: "🌿 Controle de mato",
              description: "Herbicidas e daninhas",
            },
            {
              id: "plantio_8",
              title: "🐛 Pragas",
              description: "Tratamento de sementes e pragas",
            },
            {
              id: "plantio_9",
              title: "✂️ Corte e silagem",
              description: "Ponto de corte e partículas",
            },
            {
              id: "plantio_10",
              title: "📊 Produtividade",
              description: "Rendimento e rebrote",
            },
          ],
        }],
      },
    },
  });
  const metaId2 = (r2.data as Json)?.messages
    ? (((r2.data as Json).messages as Json[])[0]?.id as string)
    : null;
  if (!r2.ok || !metaId2) {
    const detail = JSON.stringify(r2.data).slice(0, 300);
    throw new Error(
      `Meta não confirmou lista de plantio (${r2.status}): ${detail}`,
    );
  }
  const cwMsgId2 = await registra("Quer ver outro tema? [lista 10 temas]");
  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: "interactive",
    content: "Quer ver outro tema? [lista]",
    meta_message_id: metaId2,
    chatwoot_message_id: cwMsgId2,
    status: r2.ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });
}

function socialPlantioListPiece(): { type: string; payload: Json } {
  return {
    type: "list",
    payload: {
      text: "Quer consultar outro tema de plantio? Escolha abaixo.",
      sections: [{
        rows: [
          { id: "plantio_1", title: "A semente" },
          { id: "plantio_2", title: "Plantio em linha" },
          { id: "plantio_3", title: "Plantio a lanço" },
          { id: "plantio_4", title: "Calagem do solo" },
          { id: "plantio_5", title: "Adubação de base" },
          { id: "plantio_6", title: "Adubação cobertura" },
          { id: "plantio_7", title: "Controle de mato" },
          { id: "plantio_8", title: "Pragas" },
          { id: "plantio_9", title: "Corte e silagem" },
          { id: "plantio_10", title: "Produtividade" },
        ],
      }],
    },
  };
}

async function handleSocialPlantioSequence(
  db: Db,
  channel: Json,
  from: string,
): Promise<void> {
  const { data: pdfMedia } = await db.from("funnel_media").select("url")
    .eq("funnel", "mega-sorgo").eq("slot", "plantio_pdf")
    .eq("active", true).limit(1).maybeSingle();
  const pieces: { type: string; payload: Json }[] = [];
  if (pdfMedia?.url) {
    pieces.push({
      type: "text",
      payload: {
        content:
          `📄 Instruções completas de plantio do Mega Sorgo Santa Elisa:\n${pdfMedia.url}`,
      },
    });
  }
  pieces.push({
    type: "interactive",
    payload: {
      text:
        "🌱 O que o senhor precisa resolver agora no plantio? Escolha uma opção e eu envio a orientação direto ao ponto.",
      buttons: [
        { id: "plantio_inicio", title: "Como começar" },
        { id: "plantio_solo", title: "Solo e adubação" },
        { id: "plantio_colheita", title: "Corte e silagem" },
      ],
    },
  });
  await sendSocialPieces(db, channel, from, pieces);
}

// ── Info Nutricional — dados do Laboratório Prado (amostra 2025-12-05) ──
const NUTRICAO_ROWS = [
  {
    id: "nutricao_1",
    title: "🔬 Visão geral",
    description: "Matéria seca, umidade e pH",
  },
  {
    id: "nutricao_2",
    title: "💪 Proteína",
    description: "Proteína bruta e aminoácidos",
  },
  {
    id: "nutricao_3",
    title: "⚡ Energia (NDT)",
    description: "Nutrientes digestíveis totais",
  },
  { id: "nutricao_4", title: "🌾 Fibras", description: "FDN, FDA e lignina" },
  {
    id: "nutricao_5",
    title: "🧪 Minerais",
    description: "Cálcio, fósforo, magnésio...",
  },
  {
    id: "nutricao_6",
    title: "🧈 Gordura",
    description: "Extrato etéreo e ácidos graxos",
  },
  {
    id: "nutricao_7",
    title: "🔄 Digestibilidade",
    description: "DFDN em 12h, 24h, 48h...",
  },
  {
    id: "nutricao_8",
    title: "🧫 Fermentação",
    description: "Ácido lático, acético e pH",
  },
  {
    id: "nutricao_9",
    title: "🥛 Produção estimada",
    description: "Leite e carne por tonelada",
  },
  {
    id: "nutricao_10",
    title: "📊 Comparativo",
    description: "Mega Sorgo vs referência",
  },
];

const NUTRICAO_RESUMOS: Record<string, string> = {
  nutricao_1: "🔬 *Visão Geral da Silagem*\n\n" +
    "• Matéria Seca: *32,91%* (ideal é entre 30-35%)\n" +
    "• Umidade: *67,09%*\n" +
    "• pH: *4,13* (ótimo! Silagem bem fermentada)\n\n" +
    "👉 São resultados da amostra do laudo; a avaliação da silagem depende do conjunto dos parâmetros e do uso previsto.",

  nutricao_2: "💪 *Proteína*\n\n" +
    "• Proteína Bruta (PB): *9,65%* da matéria seca\n" +
    "• Proteína Solúvel: *51,09%* da PB\n" +
    "• Aminoácidos Totais: *80,93%* da PB\n" +
    "• Lisina: *3,11%* | Metionina: *1,66%*\n\n" +
    "👉 A proteína é um dos dados da amostra; a adequação depende dos demais ingredientes e da dieta do rebanho.",

  nutricao_3: "⚡ *Energia — NDT (Nutrientes Digestíveis Totais)*\n\n" +
    "• NDT: *65,22%* (método OARDC)\n" +
    "• Energia Líquida Lactação: *1,48 Mcal/kg*\n" +
    "• Energia Líquida Ganho: *0,95 Mcal/kg*\n" +
    "• Energia Líquida Manutenção: *1,55 Mcal/kg*\n\n" +
    "👉 Use estes valores da amostra para formular a dieta com um profissional; eles não preveem sozinhos a produção de leite ou carne.",

  nutricao_4: "🌾 *Fibras*\n\n" +
    "• FDN (Fibra em Detergente Neutro): *49,94%*\n" +
    "• FDA (Fibra em Detergente Ácido): *32,31%*\n" +
    "• Lignina: *3,40%* (7,06% do FDN)\n" +
    "• FDN efetivo (aFDNmo): *48,14%*\n\n" +
    "👉 Os resultados de fibra devem ser interpretados junto com a dieta completa, o volumoso e a categoria animal.",

  nutricao_5: "🧪 *Minerais*\n\n" +
    "• Cinza (Matéria Mineral): *6,24%*\n" +
    "• Cálcio: *0,35%*\n" +
    "• Fósforo: *0,26%*\n" +
    "• Magnésio: *0,18%*\n" +
    "• Potássio: *1,55%*\n" +
    "• Enxofre: *0,14%*\n\n" +
    "👉 Compare estes valores com a exigência da categoria animal e os demais componentes da dieta.",

  nutricao_6: "🧈 *Gordura (Extrato Etéreo)*\n\n" +
    "• Extrato Etéreo (EE): *3,10%*\n" +
    "• Ácidos Graxos Totais: *1,93%*\n" +
    "• Linoleico (ômega 6): *43,01%* dos AG\n" +
    "• Oleico (ômega 9): *23,83%* dos AG\n" +
    "• Linolênico (ômega 3): *8,81%* dos AG\n\n" +
    "👉 Este perfil descreve a amostra analisada; não determina sozinho o efeito na saúde ou no desempenho do rebanho.",

  nutricao_7: "🔄 *Digestibilidade da Fibra (DFDN)*\n\n" +
    "• Em 12 horas: *25,63%*\n" +
    "• Em 24 horas: *53,22%*\n" +
    "• Em 30 horas: *56,31%*\n" +
    "• Em 48 horas: *60,64%*\n" +
    "• Em 240 horas (máxima): *70,57%*\n\n" +
    "👉 A digestibilidade depende do método e da amostra; avalie o resultado junto com a dieta completa.",

  nutricao_8: "🧫 *Fermentação da Silagem*\n\n" +
    "• pH: *4,13* ✅ (excelente!)\n" +
    "• Ácido Lático: *2,81%* (o principal — fermenta bem)\n" +
    "• Ácido Acético: *1,73%* (normal)\n" +
    "• Ácido Propiônico: *0,44%* (baixo = sem deterioração)\n" +
    "• Amônia (NH3): *0,68%* (muito baixo = proteína preservada)\n\n" +
    "👉 Estes indicadores são da amostra examinada; a fermentação pode variar entre lotes e silos.",

  nutricao_9: "🥛 *Produção Estimada por Tonelada de MS*\n\n" +
    "• Leite: *1.535 kg* por tonelada de matéria seca\n" +
    "• Carne: *98 kg* por tonelada de matéria seca\n" +
    "• Amido: *17,31%* (fonte de energia rápida)\n" +
    "• Digestibilidade do Amido em 7h: *73,93%*\n" +
    "• Açúcar: *4,06%*\n\n" +
    "👉 A produção indicada é uma estimativa associada à amostra, não uma garantia de leite ou carne por tonelada. O resultado depende da dieta total, dos animais e do manejo.",

  nutricao_10: "📊 *Comparativo — Mega Sorgo vs Referência*\n\n" +
    "• PB: *9,65%* (ref: 5,80-9,00%) ✅ *Acima*\n" +
    "• NDT: *65,22%* ✅ *Alta energia*\n" +
    "• FDN: *49,94%* (ref: 31,6-49,2%) — *dentro do topo*\n" +
    "• FDA: *32,31%* (ref: 19,9-30,5%) — *aceitável*\n" +
    "• Lignina: *3,40%* (ref: 2,43-4,43%) ✅ *Baixa*\n" +
    "• Amido: *17,31%* (ref: 19,2-41,9%)\n" +
    "• Leite/ton MS: *1.535 kg*\n\n" +
    "👉 As análises são do laudo desta amostra. Compare com referências do mesmo método e base antes de tirar conclusões para outras áreas.",
};

const NUTRICAO_DISCLAIMER =
  "ℹ️ Valores do laudo do Laboratório Prado (amostra de dez/2025); não garantem o resultado de toda lavoura ou dieta. Use a ficha completa com um zootecnista ou nutricionista animal.";

async function handleNutricaoSequence(
  db: Db,
  channel: Json,
  from: string,
  acct?: CwAcct,
): Promise<void> {
  if (channel.type === "facebook" || channel.type === "instagram") {
    await handleSocialNutricaoSequence(db, channel, from);
    return;
  }
  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) {
    throw new Error("canal sem credenciais para enviar nutrição");
  }
  const msgPath = `${phone}/messages`;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const registra = async (texto: string): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content: texto, messageType: "outgoing" },
        acct,
      );
      return (cw?.id as number) ?? null;
    } catch {
      return null;
    }
  };
  const envia = async (body: Json, registro: string, tipo: string) => {
    const r = await sendMeta(token, msgPath, {
      messaging_product: "whatsapp",
      to: from,
      ...body,
    });
    const metaId = (r.data as Json)?.messages
      ? (((r.data as Json).messages as Json[])[0]?.id as string)
      : null;
    if (!r.ok || !metaId) {
      const detail = JSON.stringify(r.data).slice(0, 300);
      throw new Error(
        `Meta não confirmou item de nutrição (${r.status}): ${detail}`,
      );
    }
    const cwMsgId = await registra(registro);
    await db.from("messages").insert({
      conversation_id: conv?.id ?? null,
      channel_id: channel.id,
      direction: "out",
      msg_type: tipo,
      content: registro,
      meta_message_id: metaId,
      chatwoot_message_id: cwMsgId,
      status: r.ok ? "sent" : "failed",
      sent_at: new Date().toISOString(),
    });
  };

  // 1) PDF do laudo
  const { data: pdfMedia } = await db.from("funnel_media").select("url")
    .eq("funnel", "mega-sorgo").eq("slot", "nutricao_pdf").eq("active", true)
    .limit(1).maybeSingle();
  if (pdfMedia?.url) {
    await sendFunnelDocument(db, channel, {
      to: from,
      mediaUrl: pdfMedia.url as string,
      fileName: "Analise-Bromatologica-Mega-Sorgo.pdf",
      caption:
        "🧪 *Análise Bromatológica Completa* — Mega Sorgo Santa Elisa\nLaboratório Prado (dez/2025)",
      registro: "[PDF Análise Bromatológica]",
    }, acct);
    await pause(3000);
  }

  // 2) Lista interativa
  await envia(
    {
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text:
            "📋 *Quer entender os dados do laudo?*\n\nEscolha abaixo o que quer saber — te explico de um jeito fácil de entender!",
        },
        action: {
          button: "Ver os temas",
          sections: [{ title: "Info nutricional", rows: NUTRICAO_ROWS }],
        },
      },
    },
    "🧪 Lista de info nutricional [10 temas]",
    "interactive",
  );
}

export async function handleNutricaoClick(
  db: Db,
  channel: Json,
  from: string,
  id: string,
  acct?: CwAcct,
): Promise<void> {
  const resumoBase = NUTRICAO_RESUMOS[id];
  if (!resumoBase) return;
  const resumo = `${NUTRICAO_DISCLAIMER}\n\n${resumoBase}`;
  if (channel.type === "facebook" || channel.type === "instagram") {
    await sendSocialPieces(db, channel, from, [
      { type: "text", payload: { content: resumo } },
      socialNutricaoListPiece(),
    ]);
    return;
  }

  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) {
    throw new Error("canal sem credenciais para responder nutrição");
  }
  const msgPath = `${phone}/messages`;

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  const registra = async (texto: string): Promise<number | null> => {
    if (!conv?.chatwoot_conversation_id) return null;
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content: texto, messageType: "outgoing" },
        acct,
      );
      return (cw?.id as number) ?? null;
    } catch {
      return null;
    }
  };

  const r = await sendMeta(token, msgPath, {
    messaging_product: "whatsapp",
    to: from,
    type: "text",
    text: { body: resumo },
  });
  const metaId = (r.data as Json)?.messages
    ? (((r.data as Json).messages as Json[])[0]?.id as string)
    : null;
  if (!r.ok || !metaId) {
    const detail = JSON.stringify(r.data).slice(0, 300);
    throw new Error(
      `Meta não confirmou resumo de nutrição (${r.status}): ${detail}`,
    );
  }
  const cwMsgId = await registra(resumo);
  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: "text",
    content: resumo,
    meta_message_id: metaId,
    chatwoot_message_id: cwMsgId,
    status: r.ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });

  const pause = (ms: number) => new Promise((res) => setTimeout(res, ms));
  await pause(2000);
  const r2 = await sendMeta(token, msgPath, {
    messaging_product: "whatsapp",
    to: from,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "Quer ver outro dado nutricional? 👇" },
      action: {
        button: "Ver mais temas",
        sections: [{ title: "Info nutricional", rows: NUTRICAO_ROWS }],
      },
    },
  });
  const metaId2 = (r2.data as Json)?.messages
    ? (((r2.data as Json).messages as Json[])[0]?.id as string)
    : null;
  if (!r2.ok || !metaId2) {
    const detail = JSON.stringify(r2.data).slice(0, 300);
    throw new Error(
      `Meta não confirmou lista de nutrição (${r2.status}): ${detail}`,
    );
  }
  const cwMsgId2 = await registra(
    "Quer ver outro dado nutricional? [lista 10 temas]",
  );
  await db.from("messages").insert({
    conversation_id: conv?.id ?? null,
    channel_id: channel.id,
    direction: "out",
    msg_type: "interactive",
    content: "Quer ver outro dado? [lista]",
    meta_message_id: metaId2,
    chatwoot_message_id: cwMsgId2,
    status: r2.ok ? "sent" : "failed",
    sent_at: new Date().toISOString(),
  });
}

function socialNutricaoListPiece(): { type: string; payload: Json } {
  return {
    type: "list",
    payload: {
      text: "Quer consultar outro dado do laudo? Escolha abaixo.",
      sections: [{
        rows: NUTRICAO_ROWS.map((row) => ({
          id: row.id,
          title: row.title.replace(/^[^A-Za-zÀ-ÿ]+/u, "").trim(),
        })),
      }],
    },
  };
}

async function handleSocialNutricaoSequence(
  db: Db,
  channel: Json,
  from: string,
): Promise<void> {
  const { data: pdfMedia } = await db.from("funnel_media").select("url")
    .eq("funnel", "mega-sorgo").eq("slot", "nutricao_pdf")
    .eq("active", true).limit(1).maybeSingle();
  const pieces: { type: string; payload: Json }[] = [];
  if (pdfMedia?.url) {
    pieces.push({
      type: "text",
      payload: {
        content:
          `🧪 Análise Bromatológica completa do Mega Sorgo Santa Elisa:\n${pdfMedia.url}`,
      },
    });
  }
  pieces.push(socialNutricaoListPiece());
  await sendSocialPieces(db, channel, from, pieces);
}

async function handleSaudacao(
  db: Db,
  channel: Json,
  from: string,
  _acct?: CwAcct,
): Promise<void> {
  // saudação dispara o funil em QUALQUER canal (não depende de FUNIL_AUTO_ENROLL_CHANNEL).
  // A fase 1 peça 0 já abre com "Vida boa!" — não manda texto separado pra não duplicar.
  try {
    await enrollIfNew(db, channel, from);
  } catch (e) {
    console.error("saudacao enroll erro:", e);
  }
}

// Entrega de isca digital (lead magnet): manda o PDF do slot, aplica a etiqueta de interesse
// e NÃO pausa o funil. Só WhatsApp (uazapi + oficial) — o clique já chega roteado por
// handleMenuClick nos dois webhooks. Registra no Chatwoot e em messages como os demais envios.
async function handleIscaSequence(
  db: Db,
  channel: Json,
  from: string,
  isca: Isca,
  acct?: CwAcct,
): Promise<void> {
  const { data: media } = await db.from("funnel_media").select("url")
    .eq("funnel", "mega-sorgo").eq("slot", isca.slot).eq("active", true)
    .limit(1).maybeSingle();
  const link = media?.url as string | undefined;
  if (!link) throw new Error(`isca "${isca.id}" sem PDF ativo no slot ${isca.slot}`);

  await sendFunnelDocument(db, channel, {
    to: from,
    mediaUrl: link,
    fileName: isca.filename,
    caption: isca.legenda,
    registro: `[isca ${isca.id}] ${isca.filename}`,
    labels: [isca.etiqueta],
  }, acct);
}

export async function handleHumanRequest(
  db: Db,
  channel: Json,
  from: string,
  origem: "whatsapp" | "social",
  acct?: CwAcct,
  contexto: Record<string, unknown> = { tipo_pedido: "atendimento" },
): Promise<boolean> {
  const conversation = await resolveSocialConversation(db, channel, from);
  const tipoPedido = String(contexto.tipo_pedido ?? "atendimento");
  if (conversation?.id) {
    try {
      await autoPauseFunil(String(conversation.id), tipoPedido, {
        comPrazo: false,
      });
    } catch (error) {
      console.error("handleHumanRequest pausa de funil falhou:", error);
    }
  }
  const pedido = await registrarPedidoHumano(db, {
    conversationId: (conversation?.id as string | undefined) ?? null,
    channelId: String(channel.id),
    chatwootConversationId:
      (conversation?.chatwoot_conversation_id as number | undefined) ?? null,
    origem,
    contato: from,
    contexto,
  });
  const area = Number(contexto.area_hectares);
  const textoRegistrado = tipoPedido === "duvida_tecnica"
    ? "✅ Registrei sua dúvida para o Cícero confirmar com segurança. O funil ficará pausado enquanto a equipe verifica a resposta."
    : tipoPedido === "cotacao_area_livre"
    ? `✅ Registrei sua solicitação para ${area} hectares. O Cícero confirma o volume e a cotação exata.${contexto.regiao_uf ? " Região anotada: " + String(contexto.regiao_uf) + "." : " Envie também seu município e UF para confirmar o frete."}`
    : "✅ Seu pedido foi registrado para atendimento. O Cícero vai conferir sua necessidade e, se for cotação, confirma o valor conforme quantidade e região.";
  const textoFalha = tipoPedido === "duvida_tecnica"
    ? "Recebi sua dúvida, mas não consegui confirmar o encaminhamento automático. Ela está visível nesta conversa; por segurança, não vou arriscar uma resposta técnica sem confirmação."
    : "Não consegui confirmar o encaminhamento automático agora. Para garantir, envie a quantidade e sua região nesta conversa e peça novamente o atendimento.";
  const text = pedido.registrado ? textoRegistrado : textoFalha;
  await recordCommercialEvent(
    db,
    channel,
    (conversation?.id as string | undefined) ?? null,
    "pedido_atendimento",
    contexto,
    {
      origin: "cliente",
      messageId: String(contexto.message_id ?? "") || null,
    },
  );

  if (pedido.registrado && conversation?.chatwoot_conversation_id) {
    const assignee = Number(optionalEnv("CHATWOOT_ASSIGNEE_ID") ?? "0");
    if (assignee > 0) {
      try {
        await assignConversation(
          conversation.chatwoot_conversation_id as number,
          assignee,
          acct,
        );
      } catch (error) {
        console.warn("pedido humano: atribuição falhou:", String(error).slice(0, 120));
      }
    }
    try {
      await createConversationMessage(
        conversation.chatwoot_conversation_id as number,
        {
          content: `🧑‍🌾 Cliente pediu atendimento. Contexto: ${JSON.stringify(contexto).slice(0, 500)}.`,
          messageType: "outgoing",
          private: true,
        },
        acct,
      );
    } catch (error) {
      console.warn("pedido humano: nota privada falhou:", String(error).slice(0, 120));
    }
    if (origem === "social") {
      await markSocialLead(db, channel, from, ["lead-quente", "pediu-contato"], "Cliente pediu atendimento humano; confirmar necessidade, quantidade e região.");
    }
  }
  if (origem === "social") {
    await sendSocialPieces(db, channel, from, [{
      type: "text",
      payload: { content: text },
    }]);
    return pedido.registrado;
  }
  return await sendWhatsAppPiece(
    db,
    channel,
    from,
    { type: "text", text: { body: text } },
    text,
    "text",
    acct,
  );
}

export async function handleMenuClick(
  db: Db,
  channel: Json,
  from: string,
  menuId: string,
  acct?: CwAcct,
  inboundMessageId?: string,
): Promise<{ sent: boolean; reason?: "already-sent-today" }> {
  if (menuId === "menu_uso") {
    const daily = await claimDailyTag(db, String(channel.id), from, "uso");
    if (!daily.claimed) return { sent: false, reason: "already-sent-today" };
    try {
      await handleUsoQuestion(db, channel, from, undefined, acct);
      return { sent: true };
    } catch (error) {
      await releaseDailyIntent(db, daily.key);
      throw error;
    }
  }
  if (menuId === "menu_humano") {
    const origem = channel.type === "facebook" || channel.type === "instagram"
      ? "social"
      : "whatsapp";
    return {
      sent: await handleHumanRequest(db, channel, from, origem, acct, {
        tipo_pedido: "atendimento",
        ...(inboundMessageId ? { message_id: inboundMessageId } : {}),
      }),
    };
  }
  const iscaMatch = matchIsca(menuId);
  if (iscaMatch?.acao === "sim") {
    const { isca } = iscaMatch;
    const daily = await claimDailyTag(db, String(channel.id), from, isca.botaoSim);
    if (!daily.claimed) return { sent: false, reason: "already-sent-today" };
    try {
      await handleIscaSequence(db, channel, from, isca, acct);
      return { sent: true };
    } catch (error) {
      await releaseDailyIntent(db, daily.key);
      throw error;
    }
  }

  const intentByMenu: Record<string, CommercialIntent> = {
    menu_preco: "preco",
    menu_depoimento: "video",
    menu_plantio: "plantio",
    menu_nutricao: "nutricao",
  };
  const intent = intentByMenu[menuId];
  if (intent) {
    const daily = await claimDailyIntent(db, String(channel.id), from, intent);
    if (!daily.claimed) return { sent: false, reason: "already-sent-today" };
    try {
      if (menuId === "menu_preco") {
        await handlePrecoSequence(db, channel, from, acct);
      } else if (menuId === "menu_depoimento") {
        await handleVideoSequence(db, channel, from, acct);
      } else if (menuId === "menu_plantio") {
        await handlePlantioSequence(db, channel, from, acct);
      } else await handleNutricaoSequence(db, channel, from, acct);
      return { sent: true };
    } catch (error) {
      await releaseDailyIntent(db, daily.key);
      throw error;
    }
  }
  // "Agora não" da isca cai aqui e usa a mesma cauda de envio de texto do menu.
  const content = iscaMatch?.acao === "nao"
    ? iscaMatch.isca.recusaMsg
    : MENU_CONTENT[menuId];
  if (!content) return { sent: false };

  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  if (!token || !phone) return { sent: false };

  const r = await sendMeta(token, `${phone}/messages`, {
    messaging_product: "whatsapp",
    to: from,
    type: "text",
    text: { body: content },
  });
  const metaId = (r.data as Json)?.messages
    ? (((r.data as Json).messages as Json[])[0]?.id as string)
    : null;

  const { data: contact } = await db.from("contacts").select("id").eq(
    "channel_id",
    channel.id,
  ).eq("external_contact_id", from).maybeSingle();
  const { data: conv } = contact
    ? await db.from("conversations").select("id,chatwoot_conversation_id").eq(
      "contact_id",
      contact.id,
    ).neq("status", "resolved")
      .order("opened_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };

  // chatwoot_message_id no insert é OBRIGATÓRIO — sem ele o pull-loop sync-chatwoot-out acha
  // a msg "órfã" no Chatwoot e reenvia como texto (duplicação).
  let cwMsgId: number | null = null;
  if (conv?.chatwoot_conversation_id) {
    try {
      const cw = await createConversationMessage(
        conv.chatwoot_conversation_id as number,
        { content, messageType: "outgoing" },
        acct,
      );
      cwMsgId = (cw?.id as number) ?? null;
    } catch (e) {
      console.warn(
        "handleMenuClick: registro Chatwoot falhou",
        String(e).slice(0, 150),
      );
    }
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

  // "Já te conectei com o Cícero" era só texto: o funil seguia empilhando peça por cima e
  // ninguém ficava sabendo do pedido. Agora para o funil (sem prazo) e levanta alerta.
  // Vale para o WhatsApp oficial e para a uazapi — as duas rotas passam por aqui.
  if (menuId === "menu_humano") {
    await registrarPedidoHumano(db, {
      conversationId: (conv?.id as string | undefined) ?? null,
      channelId: String(channel.id),
      chatwootConversationId: (conv?.chatwoot_conversation_id as number | undefined) ?? null,
      origem: "whatsapp",
      contato: from,
    });
  }
  return { sent: r.ok };
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
    const pricingCategory =
      ((s.pricing as Json | undefined)?.category as string | undefined) ??
        ((s.conversation as Json | undefined)?.origin as Json | undefined)
          ?.type as string | undefined;
    if (pricingCategory) patch.pricing_category = pricingCategory;
    await db.from("messages").update(patch).eq("meta_message_id", wamid).eq(
      "direction",
      "out",
    );

    if (status === "failed") {
      const errors = (s.errors ?? []) as Json[];
      const code = errors[0]?.code as number | undefined;
      const recipient = stringValue(s.recipient_id);
      if (recipient && code && DEAD_NUMBER_ERRORS.has(code)) {
        // marca contato como número morto (attributes.dead) p/ limpar das campanhas.
        const { data: contact } = await db.from("contacts").select(
          "id,attributes",
        )
          .eq("channel_id", channel.id).eq("external_contact_id", recipient)
          .maybeSingle();
        if (contact) {
          const attrs = (contact.attributes ?? {}) as Json;
          await db.from("contacts").update({
            attributes: {
              ...attrs,
              dead: true,
              dead_reason: code,
              dead_at: new Date().toISOString(),
            },
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

    const acct = await accountForChannel(channel.id as string);
    for (
      const comment of parseSocialCommentChanges(
        String(p.object ?? ""),
        entry,
        channel as Json,
      )
    ) {
      const ingest = await ingestInbound(db, channel as Json, {
        from: comment.from,
        name: comment.name,
        metaMessageId: comment.commentId,
        msgType: "text",
        content: comment.content,
        sentAt: comment.sentAt,
        acct,
      });
      if (ingest.inserted) {
        await maybeAutoReplySocialComment(db, channel as Json, comment);
      }
    }

    for (const m of ((entry.messaging ?? []) as Json[])) {
      const sender = (m.sender as Json)?.id as string | undefined;
      const message = m.message as Json | undefined;
      const postback = m.postback as Json | undefined;
      if (!sender || (!message && !postback)) continue; // ignora delivery/read
      if (message?.is_echo) continue; // ignora echo das mensagens enviadas pela própria página
      if (message && hasMessengerAttachments(message)) continue; // o sync-facebook baixa e envia a mídia real
      const actionId = ((message?.quick_reply as Json | undefined)?.payload as
        | string
        | undefined) ??
        (postback?.payload as string | undefined) ?? "";
      const text = (message?.text as string | undefined) ??
        (postback?.title as string | undefined) ?? actionId ?? "[anexo]";

      // o webhook não manda o nome do remetente -- a Graph API devolve via GET /{id}?fields=name
      // mesmo quando o evento não traz (comum no Instagram). Sem isso, Chatwoot cria nome
      // aleatório tipo "fragrant-feather-524".
      const profile = await fetchSenderProfile(
        db,
        channel.id as string,
        sender,
      );

      const inboundEventId = (message?.mid as string | undefined) ??
        (postback?.mid as string | undefined) ??
        `postback-${sender}-${String(entry.time ?? Date.now())}-${actionId}`;
      const referral = (m.referral as Json | undefined) ??
        (postback?.referral as Json | undefined) ?? undefined;
      await ingestInbound(db, channel as Json, {
        from: sender,
        name: profile.name,
        avatarUrl: profile.avatarUrl,
        metaMessageId: inboundEventId,
        msgType: "text",
        content: text,
        acct,
        referral,
      });

      const repliedAt = message?.timestamp
        ? new Date(Number(message.timestamp) * 1000).toISOString()
        : undefined;
      const inferredReply = !actionId
        ? await inferSocialReplyFromRecentPrompt(
          db,
          String(channel.id),
          sender,
          text,
          repliedAt,
        )
        : null;
      const menuAction = !actionId ? inferSocialMenuAction(text) : null;
      const commercialIntent = !actionId
        ? classificarIntencaoComercial(text)
        : null;
      const salesIntent = !actionId ? inferSocialSalesIntent(text) : null;
      const recognizedAction = /^(?:menu_(?:preco|depoimento|plantio|nutricao|uso|humano)|preco_|tam_|pag_|uso_|plantio_|nutricao_)/
        .test(actionId);
      const humanHandoffWillHandle = actionId === "menu_humano" ||
        commercialIntent === "duvida_tecnica" ||
        (isAreaAcimaDosPacotes(text) && extrairAreaHectares(text) !== null);
      let adEnrollment: Awaited<ReturnType<typeof autoEnrollFunil>> | null = null;
      try {
        adEnrollment = await autoEnrollFunil(
          db,
          channel as Json,
          sender,
          text,
          Boolean(referral),
          {
            responseWillHandle: Boolean(
              (recognizedAction || inferredReply || menuAction || commercialIntent || salesIntent) &&
                !humanHandoffWillHandle
            ),
            humanHandoffWillHandle,
          },
        );
      } catch (error) {
        console.error(
          "hub-webhook social auto-enroll erro:",
          String(error).slice(0, 200),
        );
      }

      if (
        /^(?:menu_(?:preco|depoimento|plantio|nutricao|uso)|preco_|tam_|pag_|uso_|plantio_|nutricao_)/
          .test(actionId)
      ) {
        const claimed = await claimDelivery(
          db,
          socialPriceActionClaimKey(
            channel.id as string,
            inboundEventId,
            actionId,
          ),
          "social-price-action",
        );
        if (claimed && actionId.startsWith("menu_")) {
          if (actionId === "menu_preco") {
            await recordInboundCommercialIntent(db, channel as Json, sender, "preco", inboundEventId);
          } else if (actionId === "menu_uso") {
            await recordInboundCommercialIntent(db, channel as Json, sender, "interesse_geral", inboundEventId);
          }
          await handleMenuClick(db, channel as Json, sender, actionId, acct, inboundEventId);
        } else if (claimed && actionId.startsWith("plantio_")) {
          await handlePlantioClick(db, channel as Json, sender, actionId, acct);
        } else if (claimed && actionId.startsWith("nutricao_")) {
          await handleNutricaoClick(
            db,
            channel as Json,
            sender,
            actionId,
            acct,
          );
        } else if (claimed) {
          await handleSocialPrecoClick(
            db,
            channel as Json,
            sender,
            actionId,
            inboundEventId,
          );
        }
      } else if (actionId === "menu_humano") {
        await handleSocialSalesIntent(
          db,
          channel as Json,
          sender,
          text,
          inboundEventId,
          "contact",
        );
      } else if (!actionId) {
        if (commercialIntent) {
          await recordInboundCommercialIntent(
            db, channel as Json, sender, commercialIntent, inboundEventId,
          );
        }
        if (inferredReply) {
          const claimed = await claimDelivery(
            db,
            socialPriceActionClaimKey(String(channel.id), inboundEventId, inferredReply),
            "social-price-action",
          );
          if (claimed) {
            await handleSocialPrecoClick(
              db,
              channel as Json,
              sender,
              inferredReply,
              inboundEventId,
            );
          }
        } else if (menuAction) {
          const claimed = await claimDelivery(
            db,
            socialPriceActionClaimKey(String(channel.id), inboundEventId, menuAction),
            "social-menu-action",
          );
          if (claimed) {
            if (menuAction === "menu_preco") {
              await recordInboundCommercialIntent(db, channel as Json, sender, "preco", inboundEventId);
            } else if (menuAction === "menu_uso") {
              await recordInboundCommercialIntent(db, channel as Json, sender, "interesse_geral", inboundEventId);
            }
            await handleMenuClick(db, channel as Json, sender, menuAction, acct, inboundEventId);
          }
        } else if (commercialIntent === "preco") {
          await handleMenuClick(db, channel as Json, sender, "menu_preco", acct, inboundEventId);
        } else if (commercialIntent === "uso") {
          const use = usoPorResposta(text);
          if (use) {
            await handleSocialPrecoClick(
              db,
              channel as Json,
              sender,
              `uso_${use}`,
              inboundEventId,
            );
          }
        } else if (commercialIntent === "interesse_geral") {
          await handleMenuClick(db, channel as Json, sender, "menu_uso", acct, inboundEventId);
        } else if (commercialIntent === "duvida_tecnica") {
          await handleHumanRequest(db, channel as Json, sender, "social", acct, {
            tipo_pedido: "duvida_tecnica",
            pergunta: text.slice(0, 400),
            message_id: inboundEventId,
          });
        } else {
          const handled = await handleSocialSalesIntent(
            db,
            channel as Json,
            sender,
            text,
            inboundEventId,
          );
          if (!handled && adEnrollment?.humanHandoff) {
            const handoffClaimId =
              `ad-question-handoff-${channel.id}-${sender}-${inboundEventId}`;
            const claimed = await claimDelivery(
              db,
              handoffClaimId,
              "ad-question-handoff",
            );
            if (claimed) {
              try {
                await handleMenuClick(
                  db,
                  channel as Json,
                  sender,
                  "menu_humano",
                  acct,
                  inboundEventId,
                );
              } catch (error) {
                await releaseDelivery(db, handoffClaimId);
                throw error;
              }
            }
          }
        }
      }
    }
  }
}

async function fetchSenderProfile(
  db: Db,
  channelId: string,
  senderId: string,
): Promise<{ name?: string; avatarUrl?: string }> {
  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channelId).maybeSingle();
  if (!secret?.channel_token) return {};
  try {
    let res = await getMeta(
      secret.channel_token,
      `${senderId}?fields=name,profile_pic,profile_picture_url,username`,
    );
    if (!res.ok) {
      res = await getMeta(secret.channel_token, `${senderId}?fields=name`);
    }
    if (!res.ok) return {};
    const data = res.data as Json;
    return {
      name: (data.name ?? data.username) as string | undefined,
      avatarUrl: (data.profile_pic ?? data.profile_picture_url) as
        | string
        | undefined,
    };
  } catch (e) {
    console.warn(
      "fetchSenderProfile falhou",
      senderId,
      String(e).slice(0, 150),
    );
    return {};
  }
}

// ── Campanha gated: resposta do cliente dispara a sequência (janela 24h aberta) ──
//
// Exportada porque a resposta pode chegar por qualquer canal: se a campanha saiu pela rota
// híbrida (uazapi), o cliente responde no webhook do uazapi e não aqui. Enquanto isto só
// era chamado no webhook oficial, o lead respondia e a sequência não continuava.
export async function resumeCampaign(db: Db, channel: Json, from: string) {
  const key = numKey(from);
  const state = await readCampaigns();
  const t = state.targets[key];
  if (!t || t.status !== "awaiting") return; // só dispara quem está aguardando resposta
  const camp = state.campaigns.find((c) => c.id === t.campaignId);
  if (!camp) return;

  // marca ativo já (evita disparo duplo se chegar 2 msgs juntas)
  t.status = "active";
  await writeCampaigns(state);

  const { data: secret } = await db.from("channel_secrets").select(
    "channel_token",
  ).eq("channel_id", channel.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  const phone = channel.phone_number_id as string | undefined;
  const hybrid = await getHybridRoute(
    channel.id as string,
    phone ?? "",
    channel.phone_number as string,
  );
  if (!hybrid && (!token || !phone)) return;

  for (const step of camp.steps) {
    let r: { ok: boolean; status: number; data: unknown } | null = null;

    if (hybrid) {
      if (step.type === "text") {
        if (!step.text) continue;
        r = await hybridSendText(hybrid, key, step.text);
      } else {
        if (!step.file) continue;
        let mediaUrl = step.file as string;
        if (step.type === "audio") {
          const ogg = await toVoiceOgg(mediaUrl);
          if (ogg) mediaUrl = ogg;
        }
        r = await hybridSendMedia(hybrid, key, mediaUrl, step.type as string, {
          caption: (step.type !== "audio" && step.text)
            ? step.text as string
            : undefined,
          fileName: step.type === "document"
            ? (step.text as string ?? "arquivo")
            : undefined,
          isVoice: step.type === "audio",
        });
      }
      if (r) {
        console.log("resumeCampaign hybrid:", step.type, "uazapi OK");
        continue;
      }
      console.log("resumeCampaign hybrid:", step.type, "fallback oficial");
    }

    if (token && phone) {
      let body: Json;
      if (step.type === "text") {
        if (!step.text) continue;
        body = {
          messaging_product: "whatsapp",
          to: key,
          type: "text",
          text: { body: step.text },
        };
      } else {
        if (!step.file) continue;
        const media: Json = { link: step.file };
        if (step.type !== "audio" && step.text) media.caption = step.text;
        if (step.type === "document" && step.text) media.filename = step.text;
        body = {
          messaging_product: "whatsapp",
          to: key,
          type: step.type,
          [step.type]: media,
        };
      }
      r = await sendMeta(token, `${phone}/messages`, body);
      if (!r.ok) {
        console.error(
          `resumeCampaign step falhou (${step.type}):`,
          JSON.stringify((r.data as Json)?.error ?? r.data).slice(0, 200),
        );
      }
    }
  }

  // marca concluído
  const s2 = await readCampaigns();
  if (s2.targets[key]) {
    s2.targets[key].status = "done";
    s2.targets[key].step = camp.steps.length;
    s2.targets[key].ts = new Date().toISOString();
    await writeCampaigns(s2);
  }
}

function hasMessengerAttachments(message: Json): boolean {
  const attachments = message.attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

// ── Mídia WhatsApp (entrada) ──────────────────────────────────────────────────
// Baixa direto na Graph API da Meta (o Hub em modo shared não serve o binário):
// 1) GET graph.facebook.com/<ver>/<media_id> com Bearer <metaToken> -> { url, mime_type, file_size }
// 2) fetch(url) com Bearer <metaToken> -> bytes (lookaside exige o token Meta)
async function downloadWhatsAppMedia(
  metaToken: string,
  mediaId: string,
  filenameHint?: string,
): Promise<InboundAttachment | null> {
  const auth = { Authorization: `Bearer ${metaToken}` };
  const infoRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`,
    { headers: auth },
  );
  if (!infoRes.ok) {
    console.warn(
      "WA mídia metadata falhou",
      infoRes.status,
      (await infoRes.text()).slice(0, 200),
    );
    return null;
  }
  const d = await infoRes.json().catch(() => ({})) as Json;
  const url = stringValue(d.url);
  if (!url) return null;

  const declaredSize = typeof d.file_size === "number" ? d.file_size : null;
  if (declaredSize && declaredSize > MAX_ATTACHMENT_BYTES) return null;

  const res = await fetch(url, { headers: auth });
  if (!res.ok) {
    console.warn("WA mídia download falhou", res.status);
    return null;
  }

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
  m: Json,
  type: string,
  metaToken: string | undefined,
  channelId: string,
): Promise<{ content: string; attachments?: InboundAttachment[] }> {
  if (type === "text") {
    return { content: ((m.text as Json)?.body as string) ?? "" };
  }
  if (WA_MEDIA_TYPES.has(type)) {
    const media = (m[type] ?? {}) as Json;
    const mediaId = stringValue(media.id);
    const caption = stringValue(media.caption);
    const filenameHint = type === "document"
      ? stringValue(media.filename) ?? undefined
      : undefined;
    if (!metaToken) {
      console.warn(
        "WA mídia sem META_ACCESS_TOKEN — usando placeholder",
        channelId,
      );
    }
    const downloaded = metaToken && mediaId
      ? await downloadWhatsAppMedia(metaToken, mediaId, filenameHint)
      : null;
    // anexo baixou: conteúdo = legenda (ou vazio; sem rótulo "[audio]"). Sem anexo: placeholder textual.
    if (downloaded) {
      return { content: caption ?? "", attachments: [downloaded] };
    }
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
