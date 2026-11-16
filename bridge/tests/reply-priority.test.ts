import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { nativePriority, priorityLevel } from "../shared/reply-priority.ts";

const now = Date.parse("2026-10-26T12:00:00Z");
const before = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

Deno.test("prioridade nativa sobe aos 5, 10, 15 e 20 minutos", () => {
  assertEquals(priorityLevel(before(4.9), null, now), 0);
  for (const [minutes, level, native] of [[5, 1, "low"], [10, 2, "medium"], [15, 3, "high"], [20, 4, "urgent"]] as const) {
    assertEquals(priorityLevel(before(minutes), null, now), level);
    assertEquals(nativePriority(level), native);
  }
});

Deno.test("nova mensagem reinicia; resposta humana volta a Nenhuma", () => {
  assertEquals(priorityLevel(before(2), before(18), now), 0);
  assertEquals(priorityLevel(before(20), before(1), now), 0);
  assertEquals(nativePriority(0), null);
});
