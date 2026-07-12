import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { brtDay, dailyIntentKey } from "../shared/intent-dedup.ts";

Deno.test("daily commercial intent uses Fortaleza calendar day", () => {
  assertEquals(brtDay(new Date("2026-07-13T02:30:00Z")), "2026-07-12");
  assertEquals(brtDay(new Date("2026-07-13T03:01:00Z")), "2026-07-13");
});

Deno.test("daily intent key isolates intent and contact", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  assertEquals(
    dailyIntentKey("canal-1", "+5577999999999", "plantio", now),
    "commercial-intent:plantio:canal-1:+5577999999999:2026-07-13",
  );
});
