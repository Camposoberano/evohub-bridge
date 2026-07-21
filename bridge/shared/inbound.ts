// Ingestão comum de mensagens recebidas: cria contato/conversa no Chatwoot
// e persiste a mensagem no Supabase com dedupe por meta_message_id.
import { claimDelivery, type DbClient } from "./supabase.ts";
import { optionalEnv } from "./env.ts";
import { ensureCustomer } from "./customer.ts";
import {
  mergeLeadAttributes,
  sourceSnapshot,
  syncInboundCliente,
} from "./lead-profile.ts";
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
type MsgType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | "location"
  | "contact"
  | "interactive"
  | "template"
  | "unknown";

export type InboundAttachment = ChatwootAttachment & {
  sourceUrl?: string;
};

export async function ingestInbound(
  db: DbClient,
  channel: Json,
  msg: {
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
  },
): Promise<{ inserted: boolean; reason?: string; message_id?: string }> {
  const direction = msg.outgoing ? "out" : "in";
  const skip = msg.skipChatwoot === true;
  if (msg.metaMessageId) {
    // Claim ATÔMICO por (canal, wamid): impede a corrida (2 ingests concorrentes do mesmo
    // wamid) de inserir 2 linhas. Cross-canal (mesmo wamid em 2 números) é OK -> chave inclui canal.
    if (
      !(await claimDelivery(db, `wa-${channel.id}-${msg.metaMessageId}`, "wa"))
    ) {
      return { inserted: false, reason: "duplicate" };
    }
  } else {
    // Alguns provedores não-oficiais enviam retry/eco sem id estável. Sem essa guarda, cada
    // retry vira uma nova mensagem "incoming" no Chatwoot e pode formar loop pelo webhook.
    const fallbackKey = await fallbackInboundDeliveryKey(channel, msg);
    if (!(await claimDelivery(db, fallbackKey, "wa-fallback"))) {
      return { inserted: false, reason: "duplicate-fallback" };
    }
  }

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
    name: msg.name,
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
        name: msg.name || contact.name,
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

  let cwMsg: (Record<string, unknown> & { id?: number }) | null = null;
  if (skip) {
    // nativo: não posta no Chatwoot. Entrada já chega na caixa nativa pelo repasse do EVO Hub.
    cwMsg = null;
  } else if (msg.outgoing) {
    // echo do aparelho -> mensagem de SAIDA na conversa do cliente.
    cwMsg = await createConversationMessage(
      conv.chatwoot_conversation_id as number,
      {
        content: msg.content,
        messageType: "outgoing",
        attachments,
      },
      acct,
    );
  } else if (attachments.length > 0) {
    cwMsg = await createConversationMessage(
      conv.chatwoot_conversation_id as number,
      {
        content: msg.content,
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
      msg.content,
      acct,
    );
  }
  const chatwootMediaUrl = cwMsg
    ? firstAttachmentUrl(cwMsg)
    : (msg.attachments?.[0]?.sourceUrl ?? null);
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

function normalizeMsgType(value: string): MsgType {
  if (
    value === "text" || value === "image" || value === "audio" ||
    value === "video" ||
    value === "document" || value === "sticker" || value === "location" ||
    value === "contact" ||
    value === "interactive" || value === "template"
  ) return value;
  return "unknown";
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
