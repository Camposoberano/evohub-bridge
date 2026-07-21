import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { outboundClaimKey } from "../shared/outbound-dedup.ts";

Deno.test("vídeos sequenciais recebem claims diferentes", () => {
  const first = outboundClaimKey(570, "video", {
    media_url: "https://cdn.example/videos/video_1.mp4",
    caption: "Vídeo 1",
  });
  const second = outboundClaimKey(570, "video", {
    media_url: "https://cdn.example/videos/video_2.mp4",
    caption: "Vídeo 2",
  });
  assertNotEquals(first, second);
  assertEquals(
    first,
    outboundClaimKey(570, "video", {
      media_url: "https://cdn.example/videos/video_1.mp4",
      caption: "Vídeo 1",
    }),
  );
});

Deno.test("cliques legítimos usam escopos de deduplicação diferentes", () => {
  const payload = { text: "Qual outra área?" };
  assertNotEquals(
    outboundClaimKey(570, "interactive", payload, "click-1"),
    outboundClaimKey(570, "interactive", payload, "click-2"),
  );
  assertEquals(
    outboundClaimKey(570, "interactive", payload, "click-1"),
    outboundClaimKey(570, "interactive", payload, "click-1"),
  );
});
