import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fiveBusinessDayDeadline, scheduleSevenDayPieces, scheduleSevenDayTestPieces, sevenDayFirstStart,
} from "../shared/mega-sorgo-7d-schedule.ts";

Deno.test("sete dias mantêm 5 minutos entre peças, silêncio no dia 4 e horário local", () => {
  const pieces = [
    ...Array.from({ length: 12 }, (_, i) => ({ code: String(i + 1), day: 1 })),
    { code: "13", day: 2 }, { code: "24", day: 3 },
    { code: "pdf", day: 5 }, { code: "duvida", day: 6 },
    { code: "ultima", day: 7 },
  ];
  const rows = scheduleSevenDayPieces(pieces, Date.parse("2026-11-09T13:00:00Z"));
  assertEquals(rows[0].sendAt, "2026-11-09T13:00:00.000Z");
  assertEquals(rows[1].sendAt, "2026-11-09T13:05:00.000Z");
  assertEquals(rows[12].sendAt, "2026-11-10T12:00:00.000Z");
  assertEquals(rows[14].sendAt, "2026-11-13T12:00:00.000Z");
  assertEquals(rows[16].sendAt, "2026-11-15T12:00:00.000Z");
});

Deno.test("ensaio percorre o catálogo a cada 5 minutos sem envio após 20h", () => {
  const rows = scheduleSevenDayTestPieces([
    { code: "a", day: 1 }, { code: "b", day: 1 }, { code: "c", day: 2 },
  ], Date.parse("2026-11-07T22:55:00Z"));
  assertEquals(rows.map((row) => row.sendAt), [
    "2026-11-07T22:55:00.000Z",
    "2026-11-08T11:00:00.000Z",
    "2026-11-08T11:05:00.000Z",
  ]);
});

Deno.test("entrada tarde desloca o bloco inteiro para a manhã seguinte", () => {
  assertEquals(
    new Date(sevenDayFirstStart(Date.parse("2026-11-09T22:30:00Z"), 12)).toISOString(),
    "2026-11-10T11:00:00.000Z",
  );
});

Deno.test("prazo de cinco dias úteis não confunde dia 7 com vencimento", () => {
  assertEquals(fiveBusinessDayDeadline(Date.parse("2026-11-06T13:00:00Z")),
    "2026-11-13T23:00:00.000Z");
});

Deno.test("recusa dia 4 e código duplicado", () => {
  const at = Date.parse("2026-11-09T13:00:00Z");
  assertThrows(() => scheduleSevenDayPieces([{ code: "x", day: 4 }], at));
  assertThrows(() => scheduleSevenDayPieces([{ code: "x", day: 1 }, { code: "x", day: 2 }], at));
});
