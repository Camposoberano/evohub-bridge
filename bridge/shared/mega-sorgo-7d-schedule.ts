/** Agenda da versão de sete dias em America/Fortaleza (UTC-3, sem horário de verão). */
const OFFSET_MS = 3 * 60 * 60_000;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const OPEN_MINUTE = 8 * 60;
const CLOSE_MINUTE = 20 * 60;
export const SEVEN_DAY_FUNNEL_DAYS = [1, 2, 3, 5, 6, 7] as const;
export const PIECE_GAP_MINUTES = 5;

export function isSevenDaySendHour(ms = Date.now()): boolean {
  const minute = minuteOfLocalDay(ms);
  return minute >= OPEN_MINUTE && minute < CLOSE_MINUTE;
}

function localDayUtc(ms: number): number {
  const local = new Date(ms - OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
}

function minuteOfLocalDay(ms: number): number {
  const local = new Date(ms - OFFSET_MS);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

function atLocalMinute(dayUtc: number, minute: number): number {
  return dayUtc + minute * MINUTE_MS + OFFSET_MS;
}

/** Primeiro bloco só começa quando TODAS as suas peças cabem na janela. */
export function sevenDayFirstStart(enteredAt: number, firstDayCount: number): number {
  if (!Number.isFinite(enteredAt) || !Number.isInteger(firstDayCount) || firstDayCount < 1) {
    throw new Error("entrada ou número de peças inválido");
  }
  let day = localDayUtc(enteredAt);
  const start = Math.max(enteredAt, atLocalMinute(day, OPEN_MINUTE));
  if (start + (firstDayCount - 1) * PIECE_GAP_MINUTES * MINUTE_MS >=
    atLocalMinute(day, CLOSE_MINUTE)) {
    day += DAY_MS;
    return atLocalMinute(day, OPEN_MINUTE);
  }
  return start;
}

export type SevenDayPiece = { code: string; day: number };
export type ScheduledSevenDayPiece = SevenDayPiece & { sendAt: string; position: number };

/** Mantém ordem e 4 minutos entre peças; dia 4 é sempre vazio. */
export function scheduleSevenDayPieces(
  pieces: SevenDayPiece[], enteredAt: number,
): ScheduledSevenDayPiece[] {
  const counts = new Map<number, number>();
  const codes = new Set<string>();
  for (const piece of pieces) {
    if (!SEVEN_DAY_FUNNEL_DAYS.includes(piece.day as typeof SEVEN_DAY_FUNNEL_DAYS[number]) ||
      !piece.code || codes.has(piece.code)) throw new Error("peça ou dia inválido");
    codes.add(piece.code);
    counts.set(piece.day, (counts.get(piece.day) ?? 0) + 1);
  }
  if (!counts.get(1)) throw new Error("dia 1 vazio");
  for (const [day, count] of counts) {
    if ((count - 1) * PIECE_GAP_MINUTES >= CLOSE_MINUTE - OPEN_MINUTE) {
      throw new Error(`dia ${day} não cabe na janela`);
    }
  }
  const first = sevenDayFirstStart(enteredAt, counts.get(1)!);
  const firstLocalDay = localDayUtc(first);
  const used = new Map<number, number>();
  return pieces.map((piece, position) => {
    const index = used.get(piece.day) ?? 0;
    used.set(piece.day, index + 1);
    const timestamp = piece.day === 1
      ? first + index * PIECE_GAP_MINUTES * MINUTE_MS
      : atLocalMinute(firstLocalDay + (piece.day - 1) * DAY_MS,
        9 * 60 + index * PIECE_GAP_MINUTES);
    if (minuteOfLocalDay(timestamp) >= CLOSE_MINUTE) {
      throw new Error(`dia ${piece.day} fora da janela`);
    }
    return {
      ...piece,
      position,
      sendAt: new Date(timestamp).toISOString(),
    };
  });
}

/** Ensaio isolado: percorre o catálogo inteiro a cada 5 min, sem furar 08h–20h. */
export function scheduleSevenDayTestPieces(
  pieces: SevenDayPiece[], enteredAt: number, allowOutOfHours = false,
): ScheduledSevenDayPiece[] {
  const codes = new Set<string>();
  let slot = enteredAt;
  return pieces.map((piece, position) => {
    if (!SEVEN_DAY_FUNNEL_DAYS.includes(piece.day as typeof SEVEN_DAY_FUNNEL_DAYS[number]) ||
      !piece.code || codes.has(piece.code)) throw new Error("peça de teste inválida");
    codes.add(piece.code);
    const day = localDayUtc(slot);
    const minute = minuteOfLocalDay(slot);
    if (!allowOutOfHours) {
      if (minute < OPEN_MINUTE) slot = atLocalMinute(day, OPEN_MINUTE);
      else if (minute >= CLOSE_MINUTE) slot = atLocalMinute(day + DAY_MS, OPEN_MINUTE);
    }
    const sendAt = new Date(slot).toISOString();
    slot += PIECE_GAP_MINUTES * MINUTE_MS;
    return { ...piece, position, sendAt };
  });
}

/** Prazo comercial independente dos dias da cadência. Conta cinco dias úteis depois do primeiro contato. */
export function fiveBusinessDayDeadline(enteredAt: number): string {
  if (!Number.isFinite(enteredAt)) throw new Error("entrada inválida");
  let day = localDayUtc(enteredAt);
  let remaining = 5;
  while (remaining > 0) {
    day += DAY_MS;
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining--;
  }
  return new Date(atLocalMinute(day, CLOSE_MINUTE)).toISOString();
}
