import { FUNNEL_CUTOFF_MINUTE, FUNNEL_OPEN_MINUTE } from "./business-hours.ts";

const BRT_OFFSET_MS = 3 * 60 * 60_000;

// Mantém o funil entre 06:00 e 20:55 BRT; a noite não consome intervalos.
export function clampBusinessTime(ms: number, durationSec = 0): number {
  const brt = new Date(ms - BRT_OFFSET_MS);
  const startSecond = brt.getUTCHours() * 3600 + brt.getUTCMinutes() * 60 +
    brt.getUTCSeconds() + brt.getUTCMilliseconds() / 1000;
  const endSecond = startSecond + durationSec;
  if (startSecond >= FUNNEL_OPEN_MINUTE * 60 &&
    endSecond <= FUNNEL_CUTOFF_MINUTE * 60) return ms;

  const next = new Date(brt);
  if (startSecond >= FUNNEL_CUTOFF_MINUTE * 60 ||
    endSecond > FUNNEL_CUTOFF_MINUTE * 60) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  next.setUTCHours(6, 0, 0, 0);
  return next.getTime() + BRT_OFFSET_MS;
}

export function addBusinessSeconds(
  ms: number,
  seconds: number,
  followingDurationSec = 0,
): number {
  let cursor = clampBusinessTime(ms);
  let remaining = Math.max(0, seconds);

  while (remaining > 0) {
    const brt = new Date(cursor - BRT_OFFSET_MS);
    const minute = brt.getUTCHours() * 60 + brt.getUTCMinutes();
    const available = Math.max(
      0,
      (FUNNEL_CUTOFF_MINUTE - minute) * 60 - brt.getUTCSeconds(),
    );
    if (remaining <= available) {
      return clampBusinessTime(cursor + remaining * 1000, followingDurationSec);
    }
    remaining -= available;
    cursor = nextBusinessOpening(cursor);
  }

  return clampBusinessTime(cursor, followingDurationSec);
}

function nextBusinessOpening(ms: number): number {
  const brt = new Date(ms - BRT_OFFSET_MS);
  brt.setUTCDate(brt.getUTCDate() + 1);
  brt.setUTCHours(6, 0, 0, 0);
  return brt.getTime() + BRT_OFFSET_MS;
}
