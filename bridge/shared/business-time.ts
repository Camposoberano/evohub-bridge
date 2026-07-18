const BRT_OFFSET_MS = 3 * 60 * 60_000;
const OPEN_MINUTE = 6 * 60;
const CLOSE_MINUTE = 22 * 60;

// Keeps funnel time inside 06:00-22:00 BRT. Closed hours do not consume a gap.
export function clampBusinessTime(ms: number, durationSec = 0): number {
  const brt = new Date(ms - BRT_OFFSET_MS);
  const startMinute = brt.getUTCHours() * 60 + brt.getUTCMinutes();
  const endMinute = startMinute + durationSec / 60;
  if (startMinute >= OPEN_MINUTE && endMinute <= CLOSE_MINUTE) return ms;

  const next = new Date(brt);
  if (startMinute >= CLOSE_MINUTE || endMinute > CLOSE_MINUTE) {
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
      (CLOSE_MINUTE - minute) * 60 - brt.getUTCSeconds(),
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
