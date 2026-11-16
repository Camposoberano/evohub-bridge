import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isSevenDayNightTest, isSevenDayNightTestWindow } from "../shared/mega-sorgo-7d-night-test.ts";
import { scheduleSevenDayTestPieces } from "../shared/mega-sorgo-7d-schedule.ts";

Deno.test("exceção noturna vale só para as duas conversas e expira", () => {
  Deno.env.set("MEGA_SORGO_7D_TEST_CONVERSATIONS", "5004,5005");
  const now = Date.parse("2026-11-09T05:00:00Z");
  assertEquals(isSevenDayNightTestWindow(now), true);
  assertEquals(isSevenDayNightTest(5004, now), true);
  assertEquals(isSevenDayNightTest(5005, now), true);
  assertEquals(isSevenDayNightTest(673, now), false);
  assertEquals(isSevenDayNightTest(5004, Date.parse("2026-11-09T10:00:00Z")), false);
});

Deno.test("ensaio noturno agenda a partir de agora só com exceção explícita", () => {
  const now = Date.parse("2026-11-09T05:00:00Z");
  const pieces = [{ code: "04", day: 1 }, { code: "02", day: 1 }];
  assertEquals(scheduleSevenDayTestPieces(pieces, now, true)[0].sendAt,
    "2026-11-09T05:00:00.000Z");
  assertEquals(scheduleSevenDayTestPieces(pieces, now)[0].sendAt,
    "2026-11-09T11:00:00.000Z");
});
