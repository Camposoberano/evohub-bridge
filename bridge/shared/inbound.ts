// Ingestão comum de mensagens recebidas: cria contato/conversa no Chatwoot
// e persiste a mensagem no Supabase com dedupe por meta_message_id.
import { claimDelivery, type DbClient, releaseDelivery } from "./supabase.ts";
import { optionalEnv } from "./env.ts";
import { ensureCustomer } from "./customer.ts";
import {
  mergeLeadAttributes,
  sourceSnapshot,
  syncInboundCliente,
} from "./lead-profile.ts";
import {
  isUnmappedMsgType,
  type MsgType,
  normalizeMsgType,
} from "./msg-type.ts";
import {
  type ChatwootAttachment,
  createConversation,
  createConversationMessage,
  createIncomingMessage,
  type CwAcct,
  ensureContact,
  getConversationLabels,
  resolveInboxIdentifier,
  setConversationLabels,
} from "./chatwoot.ts";

type Json = Record<string, unknown>;
export type { MsgType };

// Janela pra casar o echo de saída (coexistência) com a linha já gravada pelo envio.
// 30s é folgado o bastante pra latência normal do provedor devolver o echo e curto o
// bastante pra não casar duas mensagens de texto idênticas enviadas de propósito (ex:
// "Oi!" mandado duas vezes em conversas diferentes -- aqui já filtrado por conversation_id).
const ECHO_MERGE_WINDOW_MS = 30_000;

export type InboundAttachment = ChatwootAttachment & {
  sourceUrl?: string;
};

export type IngestInboundMessage = {
  from: string;
  name?: string;
  metaMessageId?: string;
  msgType: string;
  content: string;
  sentAt?: string;
  attachments?: InboundAttachment[];
  outgoing?: boolean; // echo: mensagem enviada pelo aparelho (coexistência) -> entra como saída
  skipChatwoot?: boolean; // canal nativo: não posta no Chatwoot (evita duplicata), só persiste no banco
  acct?: CwAcct; // conta Chatwoot do canal (multi-cliente: outra URL/token/account)
  referral?: Json; // CTWA/free entry point (ad_id, ctwa_clid, source_url...) -> origem='anuncio' (janela 72h)
  avatarUrl?: string; // foto fornecida pelo canal; WhatsApp pode completar no avatar-sync
};

export async function ingestInbound(
  db: DbClient,
  channel: Json,
  msg: IngestInboundMessage,
): Promise<{ inserted: boolean; reason?: string; message_id?: string }> {
  // O claim é tirado ANTES do trabalho (é ele que impede a corrida entre dois ingests do
  // mesmo wamid). Se o trabalho falhar, o claim TEM que voltar: sem isso a retentativa do
  // webhook bate no claim, recebe "duplicate" e a mensagem do cliente some pra sempre.
  // Medido em 29/08: 73 mensagens perdidas em 24h, 59 delas mídia, por falha transitória
  // (Chatwoot 502 e download de mídia 404) depois do claim.
  const claimKey = msg.metaMessageId
    ? `wa-${channel.id}-${msg.metaMessageId}`
    : await fallbackInboundDeliveryKey(channel, msg);
  const claimSource = msg.metaMessageId ? "wa" : "wa-fallback";
  if (!(await claimDelivery(db, claimKey, claimSource))) {
    return {
      inserted: false,
      reason: msg.metaMessageId ? "duplicate" : "duplicate-fallback",
    };
  }
  try {
    return await ingestInboundClaimed(db, channel, msg);
  } catch (error) {
    await releaseDelivery(db, claimKey).catch((e) =>
      console.error("inbound: falha ao liberar claim", claimKey, e)
    );
    throw error;
  }
}

async function ingestInboundClaimed(
  db: DbClient,
  channel: Json,
  msg: IngestInboundMessage,
): Promise<{ inserted: boolean; reason?: string; message_id?: string }> {
  const direction = msg.outgoing ? "out" : "in";
  const skip = msg.skipChatwoot === true;

  const acct = msg.acct; // undefined -> funções do Chatwoot usam o default (env)
  const inboxId = await resolveInboxIdentifier(
    (channel.chatwoot_inbox_id ?? channel.chatwoot_inbox_identifier) as
      | string
      | number
      | null
      | undefined,
    acct,
    channel.chatwoot_inbox_identifier as string | undefined,
  );
  if (!inboxId) {
    throw new Error(
      `sem inbox_identifier para canal ${String(channel.id ?? "unknown")}`,
    );
  }
  if ((channel.chatwoot_inbox_identifier as string | undefined) !== inboxId) {
    await db.from("channels").update({ chatwoot_inbox_identifier: inboxId }).eq(
      "id",
      channel.id,
    );
    (channel as Json).chatwoot_inbox_identifier = inboxId;
  }
  // BSUID-proof (usernames Meta 2026): `from` pode ser um BSUID, não telefone. Só trata como
  // telefone se PARECER telefone (10-15 dígitos) — senão o Chatwoot rejeita o phone_number
  // inválido e a criação do contato quebrava. Identidade continua sendo o `from` cru.
  const pareceTelefone =
    /^\d{10,15}$/.test(String(msg.from).replace(/\D/g, "")) &&
    String(msg.from).replace(/\D/g, "") === String(msg.from);
  const phone = channel.type === "whatsapp" && pareceTelefone
    ? `+${msg.from}`
    : null;
  const { data: existing, error: contactQueryError } = await db
    .from("contacts").select("*")
    .eq("channel_id", channel.id).eq("external_contact_id", msg.from)
    .maybeSingle();
  if (contactQueryError) throw contactQueryError;

  const leadAttributes = mergeLeadAttributes(
    (existing?.attributes as Json | undefined) ?? {},
    channel,
    msg.from,
    msg.referral,
    msg.avatarUrl,
  );
  const customerId = await ensureCustomer(db, {
    channelId: channel.id as string,
    externalId: msg.from,
    phone,
    // Mesma guarda do contato logo abaixo e do `syncInboundCliente`: eco da nossa saida nao
    // renomeia ninguem. Sem isto, `customers.display_name` foi corrompido junto — 679 linhas
    // com o nome da empresa, medidas em 20/08. `ensureCustomer` preserva o nome atual quando
    // recebe undefined.
    name: msg.outgoing ? undefined : msg.name,
    avatarUrl: msg.avatarUrl,
    attributes: leadAttributes,
  });
  if (!msg.outgoing) {
    await syncInboundCliente(db, {
      channel,
      externalId: msg.from,
      customerId,
      name: msg.name,
      referral: msg.referral,
    });
  }

  let contact = existing as Json | null;
  let sourceId = (existing?.attributes as Json | undefined)?.source_id as
    | string
    | undefined;

  if (!contact || (!sourceId && !skip)) {
    // nativo: não cria contato no Chatwoot (a nativa já tem o seu) — só no banco.
    const cw = skip ? null : await ensureContact(inboxId, {
      name: msg.name,
      phone: phone ?? undefined,
      identifier: msg.from,
    }, acct);
    if (cw) sourceId = cw.source_id;
    const { data: upserted, error: upsertError } = await db.from("contacts")
      .upsert({
        channel_id: channel.id,
        external_contact_id: msg.from,
        customer_id: customerId,
        name: msg.name ?? null,
        phone: phone,
        chatwoot_contact_id: cw?.contact_id ??
          (contact?.chatwoot_contact_id ?? null),
        attributes: sourceId
          ? { ...leadAttributes, source_id: sourceId }
          : leadAttributes,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "channel_id,external_contact_id" }).select().single();
    if (upsertError) throw upsertError;
    contact = upserted as Json;
  } else {
    const { error: updateError } = await db.from("contacts")
      .update({
        customer_id: customerId,
        // Eco da nossa saida nao renomeia o contato: quem assina a mensagem ali somos nos,
        // nao o lead. Mesma guarda que `syncInboundCliente` ja tinha algumas linhas acima —
        // e por ela ter faltado aqui que `clientes.wa_name` manteve o nome certo enquanto
        // `contacts.name` virou "Campo Soberano" em 668 linhas.
        name: (msg.outgoing ? null : msg.name) || contact.name,
        phone,
        attributes: sourceId
          ? { ...leadAttributes, source_id: sourceId }
          : leadAttributes,
        last_seen_at: new Date().toISOString(),
      })
      .eq("id", contact.id);
    if (updateError) throw updateError;
  }

  const { data: openConv, error: convQueryError } = await db
    .from("conversations").select("*")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (convQueryError) throw convQueryError;

  let conv = openConv as Json | null;
  const source = sourceSnapshot(channel, msg.from, msg.referral);
  if (!conv) {
    // nativo: conversa só no banco (a nativa gerencia a dela).
    const cwConv = skip
      ? null
      : await createConversation(inboxId, sourceId!, acct);
    const { data: insertedConv, error: convInsertError } = await db.from(
      "conversations",
    ).insert({
      channel_id: channel.id,
      contact_id: contact.id,
      chatwoot_conversation_id: cwConv?.id ?? null,
      status: "open",
      origem: msg.referral ? "anuncio" : null,
      referral: msg.referral ?? null,
      ...source,
    }).select().single();
    if (convInsertError) throw convInsertError;
    conv = insertedConv as Json;
  } else {
    const sourceUpdate = {
      ...source,
      origem: msg.referral ? "anuncio" : conv.origem,
      referral: msg.referral ?? conv.referral ?? null,
    };
    await db.from("conversations").update(sourceUpdate).eq("id", conv.id);
    conv = { ...conv, ...sourceUpdate };
  }

  const attachments = msg.attachments ?? [];
  if (!msg.outgoing && attachments.length === 0 && msg.content.trim()) {
    const { data: recentDup, error: recentDupError } = await db.from(
      "messages",
    ).select("id,sent_at")
      .eq("channel_id", channel.id)
      .eq("conversation_id", conv.id)
      .eq("direction", "in")
      .eq("content", msg.content)
      .eq("msg_type", normalizeMsgType(msg.msgType))
      .gte("sent_at", new Date(Date.now() - 30_000).toISOString())
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentDupError) throw recentDupError;
    if (recentDup) return { inserted: false, reason: "duplicate-recent-text" };
  }

  // Echo de saída (coexistência). Quando o payload do provedor não traz wasSentByApi, a
  // mensagem que o próprio bridge acabou de enviar volta pelo webhook e vira uma SEGUNDA linha
  // em messages -- medido em 6,5% das linhas do relatório, inflando "Enviadas" e daily_metrics.
  // Aqui a linha já gravada pelo envio absorve o echo (completa o meta_message_id, que o
  // caminho de envio nem sempre tem) em vez de duplicar. Só texto: echo de mídia sem legenda
  // não tem conteúdo para casar com segurança.
  if (msg.outgoing && msg.content.trim()) {
    const { data: echoDup, error: echoDupError } = await db.from("messages")
      .select("id,meta_message_id")
      .eq("conversation_id", conv.id)
      .eq("direction", "out")
      .eq("content", msg.content)
      .gte(
        "sent_at",
        new Date(Date.now() - ECHO_MERGE_WINDOW_MS).toISOString(),
      )
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (echoDupError) throw echoDupError;
    if (echoDup) {
      if (msg.metaMessageId && !echoDup.meta_message_id) {
        await db.from("messages")
          .update({ meta_message_id: msg.metaMessageId })
          .eq("id", echoDup.id);
      }
      return {
        inserted: false,
        reason: "duplicate-echo",
        message_id: echoDup.id as string,
      };
    }
  }

  // Áudio/imagem sem legenda chegam com content vazio. Postar string vazia no Chatwoot é
  // rejeitado e derrubava a ingestão inteira — 46 áudios perdidos em 24h (medido 29/08).
  // O rótulo do tipo mantém a mensagem visível e preserva a entrada que abre a janela.
  const conteudoParaChatwoot = msg.content.trim() ||
    (attachments.length > 0 ? "" : rotuloDoTipo(msg.msgType));

  let cwMsg: (Record<string, unknown> & { id?: number }) | null = null;
  try {
  if (skip) {
    // nativo: não posta no Chatwoot. Entrada já chega na caixa nativa pelo repasse do EVO Hub.
    cwMsg = null;
  } else if (msg.outgoing) {
    // echo do aparelho -> mensagem de SAIDA na conversa do cliente.
    cwMsg = await createConversationMessage(
      conv.chatwoot_conversation_id as number,
      {
        content: conteudoParaChatwoot,
        messageType: "outgoing",
        attachments,
      },
      acct,
    );
  } else if (attachments.length > 0) {
    cwMsg = await createConversationMessage(
      conv.chatwoot_conversation_id as number,
      {
        content: conteudoParaChatwoot,
        messageType: "incoming",
        attachments,
      },
      acct,
    );
  } else {
    cwMsg = await createIncomingMessage(
      inboxId,
      sourceId!,
      conv.chatwoot_conversation_id as number,
      conteudoParaChatwoot,
      acct,
    );
  }
  } catch (error) {
    // Chatwoot fora do ar (502 em rajada é recorrente aqui) não pode custar a mensagem:
    // persistimos no banco assim mesmo. É o banco que alimenta janela, funil e relatório;
    // o registro no Chatwoot fica pendente e vira evento pra reconciliação.
    console.error(
      "inbound: registro no Chatwoot falhou, persistindo só no banco:",
      String(error).slice(0, 200),
    );
    await db.from("events").insert({
      source: "inbound",
      event_type: "chatwoot_post_failed",
      channel_id: channel.id,
      payload: {
        conversation_id: conv.id,
        chatwoot_conversation_id: conv.chatwoot_conversation_id ?? null,
        meta_message_id: msg.metaMessageId ?? null,
        msg_type: msg.msgType,
        erro: String(error).slice(0, 300),
      },
    }).then(() => {}, () => {});
    cwMsg = null;
  }
  const chatwootMediaUrl = cwMsg
    ? firstAttachmentUrl(cwMsg)
    : (msg.attachments?.[0]?.sourceUrl ?? null);
  if (isUnmappedMsgType(msg.msgType)) {
    // Tipo cru sem alias conhecido: cai em "unknown" mesmo assim, mas fica no log pra virar
    // entrada nova em ALIASES de bridge/shared/msg-type.ts em vez de continuar sumindo.
    console.warn("inbound: msgType sem mapeamento ->", msg.msgType);
  }
  const { data: insertedMessage, error: messageError } = await db.from(
    "messages",
  ).insert({
    conversation_id: conv.id,
    channel_id: channel.id,
    direction,
    msg_type: normalizeMsgType(msg.msgType),
    content: msg.content,
    media_url: chatwootMediaUrl,
    meta_message_id: msg.metaMessageId ?? null,
    chatwoot_message_id: cwMsg?.id ?? null,
    status: msg.outgoing ? "sent" : "received",
    sent_at: msg.sentAt ?? new Date().toISOString(),
  }).select("id").single();

  if (messageError) {
    if ((messageError as { code?: string }).code === "23505") {
      return { inserted: false, reason: "duplicate" };
    }
    throw messageError;
  }

  // Decisão 01/07: resposta/clique do cliente NÃO trava o funil. O Cícero recebe a resposta
  // no Chatwoot e responde manualmente EM PARALELO; a sequência segue até o fim. (As sequências
  // por botão -- preço, vídeos etc. -- serão desenvolvidas depois; aí volta o cancelamento
  // seletivo.) Reativar o comportamento antigo: FUNIL_CANCEL_ON_REPLY=true.
  if (!msg.outgoing && optionalEnv("FUNIL_CANCEL_ON_REPLY") === "true") {
    db.from("scheduled_messages").update({ status: "cancelled" })
      .eq("conversation_id", conv.id).eq("status", "pending").then(
        () => {},
        () => {},
      );
    db.from("sales_sequences").update({ status: "replied" })
      .eq("conversation_id", conv.id).eq("status", "running").then(
        () => {},
        () => {},
      );
  }

  if (!msg.outgoing && conv.chatwoot_conversation_id) {
    try {
      const labels = await getConversationLabels(
        conv.chatwoot_conversation_id as number,
        acct,
      );
      if (labels.includes("recuperacao-aguardando")) {
        await setConversationLabels(
          conv.chatwoot_conversation_id as number,
          [
            ...new Set([
              ...labels.filter((label) => label !== "recuperacao-aguardando"),
              "recuperacao-respondeu",
            ]),
          ],
          acct,
        );
        await db.from("events").insert({
          source: "recovery",
          event_type: "recovery_replied",
          channel_id: channel.id,
          payload: {
            conversation_id: conv.id,
            chatwoot_conversation_id: conv.chatwoot_conversation_id,
            message_id: insertedMessage.id,
          },
        });
      }
    } catch (error) {
      console.warn(
        "recovery reply label falhou:",
        String(error).slice(0, 160),
      );
    }
  }

  return { inserted: true, message_id: insertedMessage.id as string };
}

// Rótulo curto pra mensagem sem texto — o mesmo vocabulário já usado nas notas do funil.
function rotuloDoTipo(msgType: string): string {
  const t = normalizeMsgType(msgType);
  if (t === "audio") return "[áudio]";
  if (t === "image") return "[imagem]";
  if (t === "video") return "[vídeo]";
  if (t === "document") return "[documento]";
  if (t === "sticker") return "[figurinha]";
  return "[mensagem sem texto]";
}

export async function repairInboundMedia(
  db: DbClient,
  messageId: string,
  input: {
    msgType: string;
    content: string;
    attachments: InboundAttachment[];
  },
): Promise<{ repaired: boolean; reason?: string }> {
  if (input.attachments.length === 0) {
    return { repaired: false, reason: "sem anexos" };
  }

  const { data: message, error: messageError } = await db.from("messages")
    .select("id,conversation_id,media_url,chatwoot_message_id")
    .eq("id", messageId)
    .single();
  if (messageError) throw messageError;
  if (message?.media_url) return { repaired: false, reason: "ja reparado" };

  const { data: conversation, error: convError } = await db.from(
    "conversations",
  )
    .select("chatwoot_conversation_id")
    .eq("id", message.conversation_id)
    .single();
  if (convError) throw convError;

  const cwConversationId = conversation?.chatwoot_conversation_id as
    | number
    | undefined;
  if (!cwConversationId) {
    return { repaired: false, reason: "sem conversa Chatwoot" };
  }

  const cwMsg = await createConversationMessage(cwConversationId, {
    content: input.content,
    messageType: "incoming",
    attachments: input.attachments,
  });
  const chatwootMediaUrl = firstAttachmentUrl(cwMsg) ??
    input.attachments[0]?.sourceUrl ?? null;

  const { error: updateError } = await db.from("messages").update({
    msg_type: normalizeMsgType(input.msgType),
    content: input.content,
    media_url: chatwootMediaUrl,
    chatwoot_message_id: cwMsg?.id ?? message.chatwoot_message_id ?? null,
    status: "received",
  }).eq("id", messageId);
  if (updateError) throw updateError;

  return { repaired: true };
}

function firstAttachmentUrl(message: Record<string, unknown>): string | null {
  const attachments = message.attachments as Json[] | undefined;
  const first = Array.isArray(attachments) ? attachments[0] : undefined;
  const attachment = first ?? (message.attachment as Json | undefined);
  if (!attachment) return null;

  const dataUrl = attachment.data_url as string | undefined;
  const thumbUrl = attachment.thumb_url as string | undefined;
  return dataUrl ?? thumbUrl ?? null;
}

async function fallbackInboundDeliveryKey(
  channel: Json,
  msg: {
    from: string;
    msgType: string;
    content: string;
    sentAt?: string;
    attachments?: InboundAttachment[];
    outgoing?: boolean;
  },
): Promise<string> {
  const firstAttachment = msg.attachments?.[0];
  const attachmentSig = firstAttachment
    ? [
      firstAttachment.filename,
      firstAttachment.contentType,
      firstAttachment.bytes?.byteLength ?? 0,
      firstAttachment.sourceUrl ?? "",
    ].join(":")
    : "";
  const bucket = fallbackTimeBucket(msg.sentAt);
  const raw = [
    channel.id ?? "",
    msg.outgoing ? "out" : "in",
    msg.from,
    msg.msgType,
    msg.content,
    attachmentSig,
    bucket,
  ].join("|");
  return `wa-fallback-${await sha256Hex(raw)}`;
}

function fallbackTimeBucket(sentAt?: string): number {
  const parsed = sentAt ? Date.parse(sentAt) : NaN;
  const time = Number.isFinite(parsed) ? parsed : Date.now();
  return Math.floor(time / (2 * 60 * 1000));
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
