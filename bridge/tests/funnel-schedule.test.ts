import { iniciosDosAcessos } from "../handlers/funil-enroll.ts";

Deno.test("automatic funnel received after 22h starts at 6h BRT", () => {
  const receivedAt = Date.parse("2026-07-12T02:00:00.000Z"); // 23h BRT
  const starts = iniciosDosAcessos(receivedAt, [0], false);
  const expected = Date.parse("2026-07-12T09:00:00.000Z"); // 6h BRT
  if (starts[0] !== expected) {
    throw new Error(`expected ${expected}, got ${starts[0]}`);
  }
});

Deno.test("manual funnel remains immediate outside business hours", () => {
  const receivedAt = Date.parse("2026-07-12T02:00:00.000Z");
  const starts = iniciosDosAcessos(receivedAt, [0], false, true);
  if (starts[0] !== receivedAt) {
    throw new Error(`expected immediate ${receivedAt}, got ${starts[0]}`);
  }
});

Deno.test("manual funnel starts now but later phases respect business hours", () => {
  const receivedAt = Date.parse("2026-07-12T02:00:00.000Z"); // 23h BRT
  const starts = iniciosDosAcessos(receivedAt, [0, 30 * 60], false, true);
  if (starts[0] !== receivedAt) {
    throw new Error(
      `expected immediate first phase ${receivedAt}, got ${starts[0]}`,
    );
  }
  const expectedSecond = Date.parse("2026-07-12T09:30:00.000Z"); // 6:30 BRT
  if (starts[1] !== expectedSecond) {
    throw new Error(`expected ${expectedSecond}, got ${starts[1]}`);
  }
});

Deno.test("automatic funnel pauses gap clock from 22h until 6h BRT", () => {
  const receivedAt = Date.parse("2026-07-12T00:00:00.000Z"); // 21h BRT
  const starts = iniciosDosAcessos(receivedAt, [0, 6 * 60 * 60], false);
  // Fase 1 termina 21:08:40. Restam 5:08:40 do intervalo ao chegar 22h.
  const expected = Date.parse("2026-07-12T14:08:40.000Z"); // 11:08:40 BRT
  if (starts[1] !== expected) {
    throw new Error(`expected ${expected}, got ${starts[1]}`);
  }
});

Deno.test("production cadence spans five phases in business time", () => {
  const receivedAt = Date.parse("2026-07-12T09:00:00.000Z"); // 6h BRT
  const gaps = [0, 30 * 60, 6 * 60 * 60, 12 * 60 * 60, 12 * 60 * 60];
  const starts = iniciosDosAcessos(receivedAt, gaps, false);
  const brtHours = starts.map((value) => {
    const brt = new Date(value - 3 * 60 * 60_000);
    return brt.getUTCHours();
  });
  if (starts.length !== 5 || brtHours.some((hour) => hour < 6 || hour >= 22)) {
    throw new Error(`invalid production starts: ${JSON.stringify(starts)}`);
  }
});
