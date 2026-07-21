import { optionalEnv } from "./env.ts";

export type SocialSalesIntent = "contact" | "info";
export type SocialMenuAction =
  | "menu_preco"
  | "menu_depoimento"
  | "menu_plantio"
  | "menu_nutricao"
  | "menu_humano";

const DEFAULT_SALES_WHATSAPP = "5519999715895";
const DEFAULT_CONTACT_IMAGE =
  "https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/funil/mega-sorgo/campo.png";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function inferSocialSalesIntent(text: string): SocialSalesIntent | null {
  const value = normalize(text).replace(/^meta ai\s+/, "");
  if (!value) return null;

  const contactPatterns = [
    /\b(?:whatsapp|telefone|contato)\b/,
    /\b(?:numero|número)\s+(?:do|de)\s+(?:vendedor|representante|cicero)\b/,
    /\bfalar\s+com\s+(?:o\s+)?(?:vendedor|representante|cicero)\b/,
    /\b(?:quero|gostaria de)\s+(?:comprar|garantir|fechar)\b/,
    /\b(?:onde|como)\s+(?:compro|comprar)\b/,
    /\b(?:me chama|pode me chamar)\b/,
    /\brepresentante\b/,
  ];
  if (contactPatterns.some((pattern) => pattern.test(value))) return "contact";

  const infoPatterns = [
    /\b(?:mais|mas)\s+informac(?:ao|oes)\b/,
    /\bquero\s+(?:informac(?:ao|oes)|saber mais)\b/,
    /\bgostaria\s+(?:de\s+)?(?:mais\s+)?informac(?:ao|oes)\b/,
    /\bposso\s+ter\s+(?:mais\s+)?informac(?:ao|oes)\b/,
    /\bme\s+(?:de|passe|manda|mande)\s+(?:mais\s+)?informac(?:ao|oes)\b/,
    /\btenho\s+interesse\b/,
    /\bcomo\s+funciona\b/,
    /\bmas\s+informacion(?:es)?\b/,
    /\bme\s+gustaria\s+(?:obtener|conseguir)\s+mas\s+informacion(?:es)?\b/,
  ];
  return infoPatterns.some((pattern) => pattern.test(value)) ? "info" : null;
}

export function inferSocialMenuAction(text: string): SocialMenuAction | null {
  const value = normalize(text).replace(/^meta ai\s+/, "");
  const actions: Record<string, SocialMenuAction> = {
    "ver preco": "menu_preco",
    "ver videos": "menu_depoimento",
    "como plantar": "menu_plantio",
    "ver plantio": "menu_plantio",
    "ver nutricao": "menu_nutricao",
    "falar com cicero": "menu_humano",
  };
  return actions[value] ?? null;
}

export function socialSalesClaimKey(
  channelId: string,
  messageId: string,
  intent: SocialSalesIntent,
): string {
  return `social-sales:${channelId}:${messageId}:${intent}`;
}

export function salesWhatsAppUrl(): string {
  const number =
    (optionalEnv("SALES_WHATSAPP_NUMBER") ?? DEFAULT_SALES_WHATSAPP)
      .replace(/\D/g, "");
  const message =
    "Olá, vim pelo Facebook/Instagram da Campo Soberano e quero falar com o Cícero.";
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function salesContactImageFallback(): string {
  return optionalEnv("SOCIAL_CONTACT_IMAGE_URL") ?? DEFAULT_CONTACT_IMAGE;
}

export const SOCIAL_INFO_TEXT =
  "Olá! Claro, vou te ajudar. O Mega Sorgo Santa Elisa é uma semente de alta produção para silagem e alimentação do rebanho. O que o senhor deseja ver primeiro?";

export function socialContactText(url = salesWhatsAppUrl()): string {
  return "Fale agora com o Cícero, representante da Campo Soberano. Ele confirma o pacote ideal, preço, frete e forma de pagamento.\n\n" +
    `Toque em \"Chamar no WhatsApp\" ou acesse ${url}\n\n` +
    "Se preferir, deixe seu WhatsApp com DDD aqui na conversa. Entraremos em contato o mais rápido possível.";
}
