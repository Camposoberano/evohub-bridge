import { foldText } from "./ad-lead.ts";
import { RESTORED_5895_FUNNEL } from "./funnel-identity.ts";

export type CanalFunil = Record<string, unknown>;

export type MotivoEntradaAnuncio =
  | "meta-referral"
  | "origem-persistida"
  | "mensagem-padrao"
  | "palavra-configurada"
  | "abertura-social";

export type EvidenciaEntradaAnuncio = {
  fromAd: boolean;
  origemPersistida: boolean;
  mensagemPadrao: boolean;
  palavraConfigurada: boolean;
  aberturaSocial: boolean;
  intencaoComercial: boolean;
};

function normalizarIdentificador(value: unknown): string {
  return foldText(String(value ?? "")).replace(/[^a-z0-9]+/g, " ").trim();
}

function digitos(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * O enrollment automático de anúncios é restrito ao canal configurado (5895 por padrão).
 * Aceita o nome/ID do canal e, para alvos numéricos com pelo menos quatro dígitos, o sufixo
 * do telefone. Não usa o WABA/phone_number_id como se fosse um número de atendimento.
 */
export function canalAlvoFunil(
  channel: CanalFunil,
  target = "5895",
): boolean {
  const alvo = normalizarIdentificador(target);
  if (!alvo) return false;

  const ids = [channel.name, channel.external_id, channel.id];
  if (ids.some((id) => normalizarIdentificador(id) === alvo)) return true;

  const alvoNumerico = digitos(target);
  const alvoEhTelefone = /^[+\d\s().-]+$/.test(String(target).trim()) &&
    alvoNumerico.length >= 4;
  if (!alvoEhTelefone) {
    return normalizarIdentificador(channel.phone_number) === alvo;
  }

  const telefone = digitos(channel.phone_number);
  if (alvoNumerico.length >= 10) return telefone === alvoNumerico;

  const nome = normalizarIdentificador(channel.name);
  if (nome === alvo || nome.endsWith(` ${alvo}`)) return true;
  if (digitos(channel.external_id) === alvoNumerico) return true;
  return telefone.endsWith(alvoNumerico);
}

/** The target channel never falls back to the obsolete two-message opening. */
export function usaNovoFunilNoCanal(
  channel: CanalFunil,
  target = "5895",
): boolean {
  return canalAlvoFunil(channel, target);
}

/**
 * Decide a inscrição sem deixar uma intenção textual apagar evidência autoritativa de anúncio.
 * A pergunta comercial só serve como fallback social quando não foi classificada como intenção.
 */
export function motivoEntradaAnuncio(
  evidence: EvidenciaEntradaAnuncio,
): MotivoEntradaAnuncio | null {
  if (evidence.fromAd) return "meta-referral";
  if (evidence.origemPersistida) return "origem-persistida";
  if (evidence.mensagemPadrao) return "mensagem-padrao";
  if (evidence.palavraConfigurada) return "palavra-configurada";
  if (evidence.aberturaSocial && !evidence.intencaoComercial) {
    return "abertura-social";
  }
  return null;
}

/** A resposta/encaminhamento imediato já abre a conversa; não enviar fase genérica por cima. */
export function suprimirAberturaGenerica(hasDirectIntent: boolean): boolean {
  return hasDirectIntent;
}

/** Ad leads keep the scheduled moments when a direct reply arrives during the first moment. */
export function deveAdiarPausaDaAbertura(
  hasPendingOpeningMessages: boolean,
  adOrigin: boolean,
): boolean {
  return hasPendingOpeningMessages && !adOrigin;
}

/** Historical conversations without a sequence are never enrolled retroactively. */
export function deveIgnorarInscricaoHistorica(
  hasSequence: boolean,
  inboundMessageCount: number,
  openedAt?: string | null,
): boolean {
  // Uma resposta pode recuperar leads criados durante a falha iniciada em 06/10.
  // Conversas anteriores preservam a proteção contra reinscrição antiga.
  const openedAtMs = Date.parse(openedAt ?? "");
  if (Number.isFinite(openedAtMs) &&
    openedAtMs >= Date.parse("2026-10-06T03:00:00.000Z")) return false;
  return !hasSequence && inboundMessageCount > 1;
}

/** A saudação interrogativa do anúncio não é pedido de atendimento humano. */
export function deveEncaminharPerguntaDeAnuncio(
  funnel: string,
  unsupportedQuestion: boolean,
): boolean {
  return unsupportedQuestion && funnel !== RESTORED_5895_FUNNEL;
}

/** Detecta apenas a falha parcial: sequência ativa criada, sem fila nem evento de sucesso. */
export function inscricaoPrecisaDeRecuperacao(
  sequenceStatus: string,
  hasScheduledMessages: boolean,
  hasEnrollmentEvent: boolean,
): boolean {
  return sequenceStatus === "running" && !hasScheduledMessages &&
    !hasEnrollmentEvent;
}
