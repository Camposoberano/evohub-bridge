import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  RECOVERY_ACTIONS,
  recoveryPieces,
} from "../shared/recovery-content.ts";

Deno.test("quatro recuperações cobrem imagem, vídeo, áudio e botões", () => {
  const allTypes = new Set<string>();
  for (let variation = 1; variation <= 4; variation++) {
    const pieces = recoveryPieces(variation, {
      image: "https://example.com/image.jpg",
      video: "https://example.com/video.mp4",
      audio: "https://example.com/audio.ogg",
    });
    for (const piece of pieces) allTypes.add(piece.type);
    const interactive = pieces.find((piece) => piece.type === "interactive");
    const buttons = (interactive?.payload.buttons ?? []) as Array<{
      id: string;
      title: string;
    }>;
    assertEquals(buttons.length, 3);
    assertEquals(buttons.every((button) => button.title.length <= 20), true);
  }
  assertEquals([...allTypes].sort(), ["audio", "interactive", "video"]);
  assertEquals(RECOVERY_ACTIONS.length, 4);
});

Deno.test("recuperação continua funcional sem mídia cadastrada", () => {
  assertEquals(recoveryPieces(1, {}).length, 1);
  assertEquals(recoveryPieces(2, {}).length, 1);
  assertEquals(recoveryPieces(3, {}).length, 1);
  assertEquals(recoveryPieces(4, {}).length, 1);
});
