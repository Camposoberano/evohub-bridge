// Entrega única de documentos dos funis.
//
// Um canal WhatsApp coexistente deve escolher a rota antes do envio: quando há
// espelho UAZAPI válido, a entrega é exclusiva pela rota híbrida. O registro
// comum via ingestInbound cria o par durável no Chatwoot/messages e impede que
// o eco do provedor seja interpretado como uma nova saída.
import { sendMeta } from "./hub.ts";
import {
  getHybridRoute,
  hybridSendMedia,
  isHybridRecipient,
  type HybridRoute,
} from "./hybrid.ts";
import { ingestInbound } from "./inbound.ts";
import type { CwAcct } from "./chatwoot.ts";
import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

export type FunnelDocumentInput = {
  to: string;
  mediaUrl: string;
  fileName: string;
  caption: string;
  registro: string;
  labels?: string[];
};

export type DocumentDeliveryResult = {
  via: "hybrid" | "official";
  providerMessageId: string | null;
};

export function decideDocumentRoute(input: {
  route: HybridRoute | null;
  to: string;
}): "hybrid" | "official" {
  return input.route && isHybridRecipient(input.to) ? "hybrid" : "official";
}

/**
 * Entrega um documento pela rota apropriada e registra a saída uma única vez.
 *
 * Falha explícita na rota híbrida não cai para o Meta: enviar pela segunda rota
 * depois de um timeout/erro da primeira é justamente a origem de PDFs duplicados.
 */
export async function sendFunnelDocument(
  db: DbClient,
  channel: Json,
  input: FunnelDocumentInput,
  acct?: CwAcct,
): Promise<DocumentDeliveryResult> {
  const route = await getHybridRoute(
    String(channel.id ?? ""),
    channel.phone_number_id as string | undefined,
    channel.phone_number as string | undefined,
  );
  const via = decideDocumentRoute({ route, to: input.to });

  let providerMessageId: string | null = null;
  if (via === "hybrid") {
    // Uma rota encontrada para o destinatário brasileiro é exclusiva. Nulo ou
    // !ok significa que o provedor não aceitou a entrega; não há fallback.
    const result = await hybridSendMedia(
      route!,
      input.to,
      input.mediaUrl,
      "document",
      { caption: input.caption, fileName: input.fileName },
    );
    if (!result || !result.ok) {
      throw new Error("UAZAPI não confirmou a entrega do documento");
    }
    providerMessageId = extractProviderMessageId(result.data);
  } else {
    const { data: secret, error: secretError } = await db.from(
      "channel_secrets",
    ).select("channel_token").eq("channel_id", channel.id).maybeSingle();
    if (secretError) throw secretError;
    const token = secret?.channel_token as string | undefined;
    const phone = channel.phone_number_id as string | undefined;
    if (!token || !phone) {
      throw new Error("canal sem credenciais oficiais para enviar documento");
    }

    const result = await sendMeta(token, `${phone}/messages`, {
      messaging_product: "whatsapp",
      to: input.to,
      type: "document",
      document: {
        link: input.mediaUrl,
        filename: input.fileName,
        caption: input.caption,
      },
    });
    if (!result.ok) {
      throw new Error(
        `Meta não confirmou a entrega do documento (${result.status}): ${
          JSON.stringify(result.data).slice(0, 300)
        }`,
      );
    }
    providerMessageId = extractProviderMessageId(result.data);
  }

  await ingestInbound(db, channel, {
    from: input.to,
    metaMessageId: providerMessageId ?? undefined,
    msgType: "document",
    content: input.registro,
    outgoing: true,
    acct,
    labels: input.labels,
  });

  return { via, providerMessageId };
}

function extractProviderMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const payload = data as Json;
  const messages = payload.messages;
  if (Array.isArray(messages)) {
    const id = (messages[0] as Json | undefined)?.id;
    if (typeof id === "string" && id) return id;
  }
  const id = payload.id;
  return typeof id === "string" && id ? id : null;
}
