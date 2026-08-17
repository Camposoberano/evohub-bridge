// campaign-pace — quantos contatos hoje, e se já pode mandar o próximo.
//
// Puro de propósito: decide o ritmo de um disparo em massa, então precisa ser conferível sem
// banco. Quem lê a fila e envia é o loop em server.ts.

/** Configuração de ritmo de uma campanha agendada. */
export type PaceConfig = {
  /** contatos no primeiro dia */
  capInicial: number;
  /** quanto sobe a cada dia */
  capIncremento: number;
  /** teto que não se ultrapassa */
  capMaximo: number;
  /** janela de disparo em hora BRT */
  horaInicio: number;
  horaFim: number;
};

export const PACE_PADRAO: PaceConfig = {
  capInicial: 50,
  capIncremento: 15,
  capMaximo: 200,
  horaInicio: 8,
  horaFim: 22,
};

const BRT_OFFSET_MS = 3 * 60 * 60_000;
const DIA_MS = 24 * 60 * 60_000;

/**
 * Teto de hoje, subindo dia a dia a partir do início da campanha.
 *
 * A rampa existe porque volume alto de cara é o que a Meta pune: número que nunca disparou e
 * de repente manda 200 é o padrão de conta comprada. Subir devagar dá tempo de a nota de
 * qualidade acompanhar — e de perceber problema com 50 pessoas em vez de 2.000.
 *
 * Dia 0 = `capInicial`. Cada dia soma `capIncremento`, até `capMaximo`.
 */
export function capDoDia(
  cfg: PaceConfig,
  inicioCampanha: number,
  now: number,
): number {
  const dias = Math.floor((now - inicioCampanha) / DIA_MS);
  if (dias < 0) return 0;
  return Math.min(cfg.capMaximo, cfg.capInicial + dias * cfg.capIncremento);
}

export function dentroDaJanela(cfg: PaceConfig, now: number): boolean {
  const h = new Date(now - BRT_OFFSET_MS).getUTCHours();
  return h >= cfg.horaInicio && h < cfg.horaFim;
}

/**
 * Intervalo entre contatos, em ms, para espalhar o teto do dia pela janela inteira.
 *
 * Espalhar importa mais que o total: 200 mensagens ao longo de 14 horas passam despercebidas;
 * as mesmas 200 em duas horas são rajada. Com teto 50 e janela de 14h dá um contato a cada
 * ~17 minutos.
 */
export function intervaloMs(cfg: PaceConfig, capHoje: number): number {
  if (capHoje <= 0) return Number.POSITIVE_INFINITY;
  const janelaMs = Math.max(1, cfg.horaFim - cfg.horaInicio) * 60 * 60_000;
  return Math.floor(janelaMs / capHoje);
}

export type DecisaoEnvio =
  | { enviar: true }
  | { enviar: false; motivo: "fora-da-janela" | "teto-do-dia" | "aguardando-intervalo" };

/**
 * Pode mandar o próximo agora?
 *
 * Três travas, nesta ordem — a primeira que falha explica o porquê, o que faz o log dizer
 * algo útil em vez de só "não enviou".
 */
export function podeEnviarAgora(input: {
  cfg: PaceConfig;
  inicioCampanha: number;
  enviadosHoje: number;
  ultimoEnvioAt: number | null;
  now: number;
}): DecisaoEnvio {
  const { cfg, now } = input;
  if (!dentroDaJanela(cfg, now)) {
    return { enviar: false, motivo: "fora-da-janela" };
  }
  const cap = capDoDia(cfg, input.inicioCampanha, now);
  if (input.enviadosHoje >= cap) {
    return { enviar: false, motivo: "teto-do-dia" };
  }
  if (
    input.ultimoEnvioAt !== null &&
    now - input.ultimoEnvioAt < intervaloMs(cfg, cap)
  ) {
    return { enviar: false, motivo: "aguardando-intervalo" };
  }
  return { enviar: true };
}

/** Início do dia BRT que contém `now` — base para contar o que já saiu hoje. */
export function inicioDoDiaBrt(now: number): string {
  const brt = new Date(now - BRT_OFFSET_MS);
  brt.setUTCHours(0, 0, 0, 0);
  return new Date(brt.getTime() + BRT_OFFSET_MS).toISOString();
}
