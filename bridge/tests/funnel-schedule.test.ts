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
  const starts = iniciosDosAcessos(receivedAt, [0], true);
  if (starts[0] !== receivedAt) {
    throw new Error(`expected immediate ${receivedAt}, got ${starts[0]}`);
  }
});
