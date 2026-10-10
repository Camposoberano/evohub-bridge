import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isWithinFunnelSendHours, nextFunnelSendAt } from "../shared/business-hours.ts";
import { addBusinessSeconds, clampBusinessTime } from "../shared/business-time.ts";

Deno.test("funil envia das 06h até antes de 20h55 BRT", () => {
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T08:59:59Z")), false);
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T09:00:00Z")), true);
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T23:54:59Z")), true);
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T23:55:00Z")), false);
  assertEquals(nextFunnelSendAt(Date.parse("2026-10-11T23:55:00Z")),
    Date.parse("2026-10-12T09:00:00Z"));
});

Deno.test("peça que atravessaria o corte recomeça às 06h", () => {
  assertEquals(clampBusinessTime(Date.parse("2026-10-11T23:54:30Z"), 60),
    Date.parse("2026-10-12T09:00:00Z"));
  assertEquals(addBusinessSeconds(Date.parse("2026-10-11T23:54:00Z"), 120),
    Date.parse("2026-10-12T09:01:00Z"));
});
