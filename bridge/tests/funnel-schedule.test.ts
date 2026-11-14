import { iniciosDosAcessos } from "../handlers/funil-enroll.ts";

Deno.test("automatic funnel received after 20h starts at 8h BRT", () => {
  const receivedAt = Date.parse("2026-07-12T02:00:00.000Z"); // 23h BRT
  const starts = iniciosDosAcessos(receivedAt, [0], false);
  const expected = Date.parse("2026-07-12T11:00:00.000Z"); // 8h BRT
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
  const expectedSecond = Date.parse("2026-07-12T11:30:00.000Z"); // 8:30 BRT: a fase manual acabou fora da janela
  if (starts[1] !== expectedSecond) {
    throw new Error(`expected ${expectedSecond}, got ${starts[1]}`);
  }
});

Deno.test("automatic funnel pauses gap clock from 20h until 8h BRT", () => {
  const receivedAt = Date.parse("2026-07-12T00:00:00.000Z"); // 21h BRT (fora da janela)
  const starts = iniciosDosAcessos(receivedAt, [0, 6 * 60 * 60], false);
  // A fase 1 começa às 8h; 560s de peças e mais 6h de intervalo útil.
  const expected = Date.parse("2026-07-12T17:09:20.000Z"); // 14:09:20 BRT
  if (starts[1] !== expected) {
    throw new Error(`expected ${expected}, got ${starts[1]}`);
  }
});

Deno.test("production cadence spans five phases in business time", () => {
  const receivedAt = Date.parse("2026-07-12T11:00:00.000Z"); // 8h BRT
  const gaps = [0, 30 * 60, 6 * 60 * 60, 12 * 60 * 60, 12 * 60 * 60];
  const starts = iniciosDosAcessos(receivedAt, gaps, false);
  const brtHours = starts.map((value) => {
    const brt = new Date(value - 3 * 60 * 60_000);
    return brt.getUTCHours();
  });
  if (starts.length !== 5 || brtHours.some((hour) => hour < 8 || hour >= 20)) {
    throw new Error(`invalid production starts: ${JSON.stringify(starts)}`);
  }
});
