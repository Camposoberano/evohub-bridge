import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { businessShiftMinutes } from "../shared/funnel-queue.ts";

Deno.test("moves an early block to 8h while preserving offsets", () => {
  assertEquals(businessShiftMinutes([
    "2026-07-13T08:21:00Z",
    "2026-07-13T08:38:00Z",
  ]), 159);
});

Deno.test("moves a block crossing 20h to next 8h", () => {
  assertEquals(businessShiftMinutes([
    "2026-07-12T23:50:00Z",
    "2026-07-13T00:00:00Z",
  ]), 670);
});

Deno.test("keeps a valid business-hours block unchanged", () => {
  assertEquals(businessShiftMinutes([
    "2026-07-12T12:00:00Z",
    "2026-07-12T12:10:00Z",
  ]), 0);
});
