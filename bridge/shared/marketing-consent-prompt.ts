import type { DbClient } from "./supabase.ts";
import type { CwAcct } from "./chatwoot.ts";
import { getHybridRoute, hybridSendMenu } from "./hybrid.ts";
import { sendMeta } from "./hub.ts";
import { ingestInbound } from "./inbound.ts";
import {
  MARKETING_CONSENT_BUTTONS,
  MARKETING_CONSENT_QUESTION,
} from "./marketing-consent.ts";

type Json = Record<string, unknown>;

/** Chamado só depois que o provedor aceitou o PDF da Embrapa. */
export async function sendMarketingConsentPrompt(
  db: DbClient,
  channel: Json,
  to: string,
  acct?: CwAcct,
): Promise<void> {
  const route = await getHybridRoute(
    String(channel.id),
    channel.phone_number_id as string | undefined,
    channel.phone_number as string | undefined,
  );
  let providerMessageId: string | undefined;
  if (route) {
    const response = await hybridSendMenu(
      route,
      to,
      MARKETING_CONSENT_QUESTION,
      [...MARKETING_CONSENT_BUTTONS],
    );
    if (!response?.ok) throw new Error("UAZAPI não confirmou pergunta de consentimento");
    const data = response.data as Json | undefined;
    providerMessageId = typeof data?.id === "string" ? data.id : undefined;
  } else {
    const { data: secret, error } = await db.from("channel_secrets")
      .select("channel_token").eq("channel_id", channel.id).maybeSingle();
    if (error) throw error;
    const token = secret?.channel_token as string | undefined;
    const phone = channel.phone_number_id as string | undefined;
    if (!token || !phone) throw new Error("canal oficial indisponível para consentimento");
    const response = await sendMeta(token, `${phone}/messages`, {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: MARKETING_CONSENT_QUESTION },
        action: {
          buttons: MARKETING_CONSENT_BUTTONS.map((button) => ({
            type: "reply",
            reply: button,
          })),
        },
      },
    });
    if (!response.ok) throw new Error(`Meta não confirmou pergunta de consentimento (${response.status})`);
    const messages = (response.data as Json | undefined)?.messages;
    const id = Array.isArray(messages) ? (messages[0] as Json | undefined)?.id : undefined;
    providerMessageId = typeof id === "string" ? id : undefined;
  }
  await ingestInbound(db, channel, {
    from: to,
    metaMessageId: providerMessageId,
    msgType: "interactive",
    content: MARKETING_CONSENT_QUESTION,
    outgoing: true,
    acct,
  });
}
