import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  MEGA_SORGO_7D_VERSION, SEVEN_DAY_CONDITIONAL_VIDEOS,
  SEVEN_DAY_CONTENT, validateSevenDayContent,
} from "../shared/mega-sorgo-7d-content.ts";

Deno.test("catálogo separado cobre 31 peças e três dias finais sem dia 4", () => {
  validateSevenDayContent();
  assertEquals(MEGA_SORGO_7D_VERSION, "mega-sorgo-7d-v1");
  assertEquals(SEVEN_DAY_CONTENT.length, 34);
  assertEquals(SEVEN_DAY_CONTENT.slice(0, 2).map((piece) => [piece.code, piece.type]),
    [["04", "audio"], ["01", "text"]]);
  assertEquals(String(SEVEN_DAY_CONTENT[1].payload.content).startsWith("🌾 *Mega Sorgo"), true);
  assertEquals(SEVEN_DAY_CONTENT.some((piece) => piece.day === 4), false);
  assertEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "08")?.day, 1);
  assertEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "18")?.day, 2);
  assertEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "24")?.day, 3);
  assertEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "d5_pdf")?.day, 5);
});

Deno.test("cinco vídeos oficiais dependem de aceite e usam a ordem confirmada", () => {
  assertEquals(SEVEN_DAY_CONDITIONAL_VIDEOS.map((item) => item.asset), [
    "VIDEO 01 INICIO 1X1.mp4", "video 02_HORIZONTAL.mp4",
    "video 03_HORIZONTAL.mp4", "video 04_VERTICAL.mp4", "video 05_HORIZONTAL.mp4",
  ]);
  assertEquals(SEVEN_DAY_CONTENT.some((piece) => piece.code === "official_01"), false);
  assertNotEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "video_invite"), undefined);
});

Deno.test("vídeos da conversa só entram após aceite", () => {
  assertEquals(SEVEN_DAY_CONTENT.filter((piece) => piece.type === "video").length, 0);
  assertEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "04")?.asset,
    "p04_sem_promessa_video.ogg");
  assertEquals(SEVEN_DAY_CONTENT.find((piece) => piece.code === "05")?.asset,
    "p05_sem_promessa_video.ogg");
});

Deno.test("PDF depende de pedido e mensagens finais não contêm marcador de nome", () => {
  const byCode = new Map(SEVEN_DAY_CONTENT.map((piece) => [piece.code, piece]));
  assertEquals(SEVEN_DAY_CONTENT.length, 34);
  assertEquals(SEVEN_DAY_CONTENT.filter((piece) => piece.type === "audio").length, 10);
  assertEquals(byCode.get("d5_pdf")?.type, "text");
  assertEquals("media_ref" in (byCode.get("d5_pdf")?.payload ?? {}), false);
  for (const code of ["d6_duvida", "d7_ultima"]) {
    assertEquals(String(byCode.get(code)?.payload.content).includes("[nome]"), false);
  }
});
