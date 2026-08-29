import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recentOutgoingCandidates } from "../handlers/sync-chatwoot-out.ts";
import { syncOutSinceMinutes } from "../shared/sync-out-state.ts";

Deno.test("recentOutgoingCandidates seleciona somente saidas recentes e publicas", () => {
  const cutoff = Date.parse("2026-08-29T12:00:00Z");
  const candidates = recentOutgoingCandidates([
    {
      id: 10,
      message_type: "outgoing",
      content: "recente",
      created_at: "2026-08-29T12:01:00Z",
    },
    {
      id: 11,
      message_type: "incoming",
      content: "cliente",
      created_at: "2026-08-29T12:01:00Z",
    },
    {
      id: 12,
      message_type: "outgoing",
      private: true,
      content: "nota",
      created_at: "2026-08-29T12:01:00Z",
    },
    {
      id: 13,
      message_type: "outgoing",
      content: "antiga",
      created_at: "2026-08-29T11:59:00Z",
    },
  ], cutoff);

  assertEquals(candidates.map((candidate) => candidate.chatwootMessageId), [
    10,
  ]);
});

Deno.test("recentOutgoingCandidates preserva midia e marca retry de falha", () => {
  const candidates = recentOutgoingCandidates([
    {
      id: "20",
      message_type: 1,
      content: "",
      attachments: [{ file_type: "video" }],
      status: "failed",
      created_at: "2026-08-29T12:01:00Z",
    },
  ], Date.parse("2026-08-29T12:00:00Z"));

  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].chatwootMessageId, 20);
  assertEquals(candidates[0].retryingFailedMessage, true);
  assertEquals(candidates[0].message.content, "");
});

Deno.test("syncOutSinceMinutes usa sobreposicao curta e recupera intervalo apos parada", () => {
  const now = Date.parse("2026-08-29T12:00:00Z");
  assertEquals(syncOutSinceMinutes(null, 2, 30, now), 30);
  assertEquals(syncOutSinceMinutes("2026-08-29T11:59:40Z", 2, 30, now), 2);
  assertEquals(syncOutSinceMinutes("2026-08-29T11:53:00Z", 2, 30, now), 8);
  assertEquals(syncOutSinceMinutes("2026-08-29T10:00:00Z", 2, 30, now), 30);
});
