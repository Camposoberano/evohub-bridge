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

Deno.test("disparo (dia 1) sai na hora da entrada, QUALQUER hora; cadência respeita a janela", () => {
  // 2026-11-10T00:30:00Z = 21:30 BRT (09/11), já fora da janela 08h–20h.
  const rows = scheduleSevenDayPieces([
    { code: "1", day: 1 }, { code: "2", day: 1 }, { code: "3", day: 1 },
    { code: "d2", day: 2 },
  ], Date.parse("2026-11-10T00:30:00Z"));
  // Dia 1 dispara na hora, 5 em 5 min, à noite — não adia nem rola pra manhã.
  assertEquals(rows[0].sendAt, "2026-11-10T00:30:00.000Z");
  assertEquals(rows[1].sendAt, "2026-11-10T00:35:00.000Z");
  assertEquals(rows[2].sendAt, "2026-11-10T00:40:00.000Z");
  // Dia 2 (cadência) já respeita a janela: 09h BRT do dia seguinte à ENTRADA (09/11 local → 10/11 09h).
  assertEquals(rows[3].sendAt, "2026-11-10T12:00:00.000Z");
  // firstStart = a própria entrada, qualquer hora.
  assertEquals(
    new Date(sevenDayFirstStart(Date.parse("2026-11-10T00:30:00Z"), 12)).toISOString(),
    "2026-11-10T00:30:00.000Z",
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
