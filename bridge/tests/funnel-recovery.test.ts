import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canAutoResume,
  rebasePausedSchedule,
  silentFollowupAt,
} from "../shared/funnel-recovery.ts";

Deno.test("retomada preserva os intervalos restantes", () => {
  assertEquals(
    rebasePausedSchedule([
      "2026-07-18T10:00:00.000Z",
      "2026-07-18T10:02:00.000Z",
      "2026-07-18T11:00:00.000Z",
    ], Date.parse("2026-07-18T15:00:00.000Z")),
    [
      "2026-07-18T15:00:00.000Z",
      "2026-07-18T15:02:00.000Z",
      "2026-07-18T16:00:00.000Z",
    ],
  );
});

Deno.test("follow-up final conta dez horas úteis e pausa durante a noite", () => {
  const lastSentAt = Date.parse("2026-07-12T00:00:00.000Z"); // 21h BRT
  const now = lastSentAt;
  assertEquals(
    silentFollowupAt(lastSentAt, now),
    Date.parse("2026-07-12T18:00:00.000Z"), // 15h BRT do dia seguinte
  );
});

Deno.test("retoma apenas pausa automática recente e sem atividade", () => {
  const now = Date.parse("2026-07-18T18:00:00.000Z");
  assertEquals(
    canAutoResume({
      now,
      pauseAt: now - 100 * 60_000,
      lastActivityAt: now - 95 * 60_000,
      lastInboundAt: now - 2 * 60 * 60_000,
      pauseType: "auto_paused",
    }),
    true,
  );
  assertEquals(
    canAutoResume({
      now,
      pauseAt: now - 100 * 60_000,
      lastActivityAt: now - 95 * 60_000,
      lastInboundAt: now - 2 * 60 * 60_000,
      pauseType: "manual_paused",
    }),
    false,
  );
  assertEquals(
    canAutoResume({
      now,
      pauseAt: now - 8 * 60 * 60_000,
      lastActivityAt: now - 7 * 60 * 60_000,
      lastInboundAt: now - 7 * 60 * 60_000,
      pauseType: "auto_paused",
    }),
    false,
  );
});
