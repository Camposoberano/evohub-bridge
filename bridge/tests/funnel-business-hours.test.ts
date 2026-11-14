import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isWithinFunnelSendHours, nextFunnelSendAt } from "../shared/business-hours.ts";
import { addBusinessSeconds, clampBusinessTime } from "../shared/business-time.ts";

Deno.test("funil envia das 08h até antes de 19h55 BRT", () => {
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T10:59:59Z")), false);
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T11:00:00Z")), true);
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T22:54:59Z")), true);
  assertEquals(isWithinFunnelSendHours(Date.parse("2026-10-11T22:55:00Z")), false);
  assertEquals(nextFunnelSendAt(Date.parse("2026-10-11T22:55:00Z")),
    Date.parse("2026-10-12T11:00:00Z"));
});

Deno.test("peça que atravessaria o corte recomeça às 08h", () => {
  assertEquals(clampBusinessTime(Date.parse("2026-10-11T22:54:30Z"), 60),
    Date.parse("2026-10-12T11:00:00Z"));
  assertEquals(addBusinessSeconds(Date.parse("2026-10-11T22:54:00Z"), 120),
    Date.parse("2026-10-12T11:01:00Z"));
});
