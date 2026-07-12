import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { businessShiftMinutes } from "../shared/funnel-queue.ts";

Deno.test("moves an early block to 6h while preserving offsets", () => {
  assertEquals(businessShiftMinutes([
    "2026-07-13T08:21:00Z",
    "2026-07-13T08:38:00Z",
  ]), 39);
});

Deno.test("moves a block crossing 22h to next 6h", () => {
  assertEquals(businessShiftMinutes([
    "2026-07-13T00:58:00Z",
    "2026-07-13T01:05:00Z",
  ]), 482);
});

Deno.test("keeps a valid business-hours block unchanged", () => {
  assertEquals(businessShiftMinutes([
    "2026-07-12T12:00:00Z",
    "2026-07-12T12:10:00Z",
  ]), 0);
});
