// Janela operacional do funil em horário de Brasília (UTC-3).
// O corte cinco minutos antes das 22h deixa margem para a entrega terminar dentro
// da janela, mesmo quando o envio demora ou a fila está processando um lote.
const BRT_OFFSET_MINUTES = 180;
const OPEN_MINUTE = 6 * 60;
const CLOSE_MINUTE = 22 * 60;
export const FUNNEL_CLOSE_BUFFER_MINUTES = 5;

export function brtMinuteOfDay(at = Date.now()): number {
  const brt = new Date(at - BRT_OFFSET_MINUTES * 60_000);
  return brt.getUTCHours() * 60 + brt.getUTCMinutes();
}

export function isWithinFunnelSendHours(at = Date.now()): boolean {
  const minute = brtMinuteOfDay(at);
  return minute >= OPEN_MINUTE &&
    minute < CLOSE_MINUTE - FUNNEL_CLOSE_BUFFER_MINUTES;
}

/** Próxima abertura às 06:00 BRT; se já passou do corte, usa o dia seguinte. */
export function nextFunnelSendAt(at = Date.now()): number {
  const brt = new Date(at - BRT_OFFSET_MINUTES * 60_000);
  const minute = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  const nextDay = minute >= CLOSE_MINUTE - FUNNEL_CLOSE_BUFFER_MINUTES;
  const day = Date.UTC(
    brt.getUTCFullYear(),
    brt.getUTCMonth(),
    brt.getUTCDate() + (nextDay ? 1 : 0),
  );
  return day + OPEN_MINUTE * 60_000 + BRT_OFFSET_MINUTES * 60_000;
}
