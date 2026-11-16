// A oferta da Embrapa aceita respostas digitadas explícitas além dos dois botões.
// Retorna undefined para todos os outros fluxos, para preservar o tratamento deles.
export const EMBRAPA_5895_CAMPAIGN_ID = "isca-embrapa-sul-sudeste-5895-2026-09-25";
import { dentroDaJanela, PACE_PADRAO, type PaceConfig } from "./campaign-pace.ts";

export function shouldDeferEmbrapaPdf(input: {
  campaignId: string;
  stepId: string;
  branchReplyId: string | null;
  pace?: Partial<PaceConfig>;
  now: number;
}): boolean {
  return input.campaignId === EMBRAPA_5895_CAMPAIGN_ID &&
    input.stepId === "oferta" && input.branchReplyId === "quero" &&
    !dentroDaJanela({ ...PACE_PADRAO, ...(input.pace ?? {}) }, input.now);
}

function normalize(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolveEmbrapaOfferReply(input: {
  campaignId: string;
  stepId: string;
  replyId: string | null;
  text: string | null | undefined;
}): "quero" | "nao" | null | undefined {
  if (input.campaignId !== EMBRAPA_5895_CAMPAIGN_ID || input.stepId !== "oferta") {
    return undefined;
  }
  if (input.replyId === "quero" || input.replyId === "nao") {
    return input.replyId;
  }
  const text = normalize(input.text ?? "");
  if (
    /^(?:quero(?: o material| o pdf| receber(?: o material| o pdf)?)?|sim quero(?: o material| o pdf)?|pode (?:me )?enviar(?: o material| o pdf)?|me manda(?: o material| o pdf)|manda(?: o material| o pdf))$/
      .test(text)
  ) {
    return "quero";
  }
  if (
    /^(?:nao|agora nao|nao obrigado|nao quero(?: o material| o pdf)?|dispenso)$/
      .test(text)
  ) {
    return "nao";
  }
  return null;
}
