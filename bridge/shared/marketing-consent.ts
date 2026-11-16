import type { DbClient } from "./supabase.ts";

export const MARKETING_CONSENT_QUESTION =
  "Você quer receber, inclusive depois desta conversa, pelo WhatsApp da Campo Soberano, materiais técnicos e ofertas sobre o Mega Sorgo Santa Elisa? Pode pedir para parar quando quiser.";

export const MARKETING_CONSENT_BUTTONS = [
  { id: "menu_marketing_sim", title: "Sim, quero receber" },
  { id: "menu_marketing_nao", title: "Não, obrigado" },
] as const;

export type MarketingConsentChoice = "yes" | "no";

export function marketingConsentChoice(id: string | null | undefined): MarketingConsentChoice | null {
  if (id === MARKETING_CONSENT_BUTTONS[0].id) return "yes";
  if (id === MARKETING_CONSENT_BUTTONS[1].id) return "no";
  return null;
}

/** O evento é a prova da escolha; a última escolha prevalece sobre as anteriores. */
export async function recordMarketingConsent(input: {
  db: DbClient;
  channelId: string;
  phone: string;
  choice: MarketingConsentChoice;
  inboundMessageId?: string | null;
  buttonId?: string | null;
}): Promise<void> {
  const phone = input.phone.replace(/\D/g, "");
  if (!/^55\d{10,11}$/.test(phone)) throw new Error("telefone inválido para registrar consentimento");
  const { error } = await input.db.from("events").insert({
    source: "marketing-consent",
    event_type: "mega_sorgo_whatsapp",
    channel_id: input.channelId,
    payload: {
      phone,
      choice: input.choice,
      business: "Campo Soberano",
      purpose: "materiais técnicos e ofertas sobre o Mega Sorgo Santa Elisa",
      question: MARKETING_CONSENT_QUESTION,
      answer_button_id: input.buttonId ?? (input.choice === "yes"
        ? MARKETING_CONSENT_BUTTONS[0].id
        : MARKETING_CONSENT_BUTTONS[1].id),
      inbound_message_id: input.inboundMessageId ?? null,
    },
  });
  if (error) throw error;
}

/** Usar esta verificação antes de qualquer nova campanha de marketing para o número. */
export async function hasMarketingConsent(
  db: DbClient,
  channelId: string,
  rawPhone: string,
): Promise<boolean> {
  const phone = rawPhone.replace(/\D/g, "");
  const { data, error } = await db.from("events")
    .select("payload")
    .eq("source", "marketing-consent")
    .eq("event_type", "mega_sorgo_whatsapp")
    .eq("channel_id", channelId)
    .contains("payload", { phone })
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data?.payload as { choice?: string } | undefined)?.choice === "yes";
}
