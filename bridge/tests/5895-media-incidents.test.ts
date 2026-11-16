import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mediaBlocks5895,
  mediaBlocks5895Detail,
  mediaBlocks5895Key,
} from "../shared/5895-media-incidents.ts";

Deno.test("agrupa bloqueios por mídia e ignora vídeos antigos com sequência liberada", async () => {
  const rows = [
    {
      id: "a",
      chatwoot_conversation_id: 3728,
      step: 5,
      type: "video",
      status: "failed",
      payload: {
        __funnel_delivery: {
          last_outcome: "uncertain",
          transport_stage: "await_receipt",
        },
      },
    },
    {
      id: "b",
      chatwoot_conversation_id: 3677,
      step: 24,
      type: "audio",
      status: "failed",
      payload: {
        __funnel_delivery: {
          last_outcome: "uncertain",
          transport_stage: "await_response",
        },
      },
    },
    {
      id: "c",
      chatwoot_conversation_id: 3550,
      step: 21,
      type: "video",
      status: "failed",
      payload: {
        __funnel_delivery: {
          last_outcome: "uncertain",
          followups_released_at: "2026-10-13T17:40:35Z",
        },
      },
    },
  ];
  const blocks = mediaBlocks5895(rows);
  assertEquals(blocks.map((block) => block.conversation), [3677, 3728]);
  assertEquals(mediaBlocks5895Detail(blocks).includes("#3728 etapa 5"), true);
  assertEquals(
    await mediaBlocks5895Key(blocks),
    await mediaBlocks5895Key([...blocks].reverse()),
  );
  assertEquals(
    await mediaBlocks5895Key(blocks) ===
      await mediaBlocks5895Key(blocks.slice(0, 1)),
    false,
  );
});
