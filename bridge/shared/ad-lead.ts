import {
  isDuvidaTecnicaIntent,
  isFechamentoIntent,
  isInteresseComercialIntent,
  isNutricaoIntent,
  isPlantioIntent,
  isPrecoIntent,
  isVideoIntent,
} from "./intent.ts";

export function foldText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizedWords(value: string): string {
  return foldText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

const AD_FUNNEL_ORIGIN_SIGNALS = new Set([
  "meta_referral",
  "persisted_ad_origin",
  "default_ad_message",
  "social_opening",
]);

export function isAdFunnelOriginSignal(signal: unknown): boolean {
  return AD_FUNNEL_ORIGIN_SIGNALS.has(String(signal ?? ""));
}

export function shouldDeferInitialAdIntent(
  originSignal: unknown,
  enrollmentOutcome: string,
): boolean {
  return isAdFunnelOriginSignal(originSignal) &&
    ["created", "in_progress"].includes(enrollmentOutcome);
}

/** Rota comercial identificada na mensagem inicial, para ser acionada após a abertura. */
export function deferredAdRoute(content: string): string | null {
  // A pergunta pré-preenchida do próprio anúncio oferece informações; não pede Cícero.
  const words = normalizedWords(content);
  if (
    words.startsWith("ola quer saber mais sobre") ||
    words.startsWith("quer saber mais sobre as sementes")
  ) return null;
  if (isPrecoIntent(content)) return "menu_preco";
  if (isVideoIntent(content)) return "menu_depoimento";
  if (isPlantioIntent(content)) return "menu_plantio";
  if (isNutricaoIntent(content)) return "menu_nutricao";
  if (isFechamentoIntent(content) || isDuvidaTecnicaIntent(content)) {
    return "menu_humano";
  }
  if (isInteresseComercialIntent(content)) return "menu_uso";
  // Pergunta desconhecida continua recebendo a abertura. Em seguida, segue para
  // atendimento humano em vez de desaparecer ou interromper a primeira mensagem.
  if (
    content.includes("?") ||
    /\b(entrega|frete|envio|envia|transport\w*)\b/i.test(content)
  ) {
    return "menu_humano";
  }
  return null;
}

/**
 * Abertura com intenção comercial — o formato de anúncio de HOJE.
 *
 * O Facebook e o Instagram oferecem perguntas prontas no anúncio, e o lead escolhe uma em vez
 * de escrever. Em 5 dias de setembro, 15 das 35 conversas sociais abriram assim:
 *
 *   "Qual é o custo da semente por hectare?"   9x
 *   "Qual é o preço das sementes?"             3x
 *   "Vocês oferecem entrega em todo o Brasil?" 3x
 *
 * Nenhuma casava com `isDefaultAdMessage`, que só conhece o texto genérico antigo
 * ("posso ter mais informações"). Sem casar, o lead não era reconhecido como vindo de anúncio:
 * o bot respondia a pergunta e o funil nunca começava — 10 dos 15 ficaram sem sequência.
 *
 * A lista de frases exatas envelhece a cada campanha nova, então aqui a decisão é por
 * INTENÇÃO: preço, custo, valor, hectare, entrega, frete. Pega a variação de amanhã sem
 * deploy. Frases extras podem ser acrescentadas em FUNIL_ICEBREAKERS.
 */
const TERMOS_COMERCIAIS = [
  "preco",
  "precos",
  "custo",
  "custa",
  "valor",
  "valores",
  "hectare",
  "entrega",
  "entregam",
  "frete",
  "orcamento",
  "quanto sai",
  "quanto fica",
];

export function pareceAberturaComercial(
  content: string,
  extras: string[] = [],
): boolean {
  const text = normalizedWords(content);
  if (!text) return false;
  if (extras.some((f) => f && text.includes(normalizedWords(f)))) return true;
  // Fronteira de palavra de propósito: "valor" não pode casar dentro de "desvalorizado",
  // e "custa" não pode casar em "custava" -- o objetivo é pergunta de abertura, não menção.
  return TERMOS_COMERCIAIS.some((termo) =>
    new RegExp(`(^| )${termo}( |$)`).test(text)
  );
}

export function isDefaultAdMessage(content: string): boolean {
  const text = normalizedWords(content);
  return [
    "ola posso ter mais informacoes",
    "posso ter mais informacoes",
    "ola gostaria de mais informacoes",
    "gostaria de mais informacoes",
    "quero mais informacoes",
    "tenho interesse e gostaria de mais informacoes",
    "hola puedo tener mas informacion",
    "hola puedo obtener mas informacion",
    "puedo tener mas informacion",
    "puedo obtener mas informacion",
    "hola me gustaria conseguir mas informacion",
    "me gustaria conseguir mas informacion",
  ].some((phrase) => text.includes(phrase));
}
