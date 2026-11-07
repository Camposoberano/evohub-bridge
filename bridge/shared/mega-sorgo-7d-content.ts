import manifest from "./mega-sorgo-7d-content.json" with { type: "json" };
import { scheduleSevenDayPieces } from "./mega-sorgo-7d-schedule.ts";

export const MEGA_SORGO_7D_VERSION = "mega-sorgo-7d-v1";
export type SevenDayContentPiece = {
  code: string;
  day: number;
  type: "text" | "text_sequence" | "image" | "audio" | "video" | "document" |
    "interactive" | "list";
  payload: Record<string, unknown>;
  asset?: string;
  script?: string;
};

export const SEVEN_DAY_CONTENT = manifest.pieces as SevenDayContentPiece[];
export const SEVEN_DAY_CONDITIONAL_VIDEOS = manifest.conditionalVideos;

/** Fail closed: incomplete media or script cannot silently become an outgoing piece. */
export function validateSevenDayContent(): void {
  if (manifest.version !== MEGA_SORGO_7D_VERSION || SEVEN_DAY_CONTENT.length !== 39 ||
    SEVEN_DAY_CONDITIONAL_VIDEOS.length !== 5) throw new Error("catálogo de sete dias incompleto");
  const codes = new Set(SEVEN_DAY_CONTENT.map((piece) => piece.code));
  for (let n = 1; n <= 31; n++) {
    if (!codes.has(String(n).padStart(2, "0"))) throw new Error(`peça ${n} ausente`);
  }
  scheduleSevenDayPieces(SEVEN_DAY_CONTENT, Date.parse("2026-11-09T13:00:00Z"));
  for (const piece of SEVEN_DAY_CONTENT) {
    if (!piece.payload || typeof piece.payload !== "object") throw new Error(`payload ${piece.code} ausente`);
    const text = JSON.stringify(piece.payload);
    if (/140\s*t(?:\/ha|\/ano)|80%\s*superior|quase imune/i.test(text)) {
      throw new Error(`claim antigo na peça ${piece.code}`);
    }
    if (["audio", "video", "image", "document"].includes(piece.type) &&
      (!piece.asset || !piece.payload.media_ref)) throw new Error(`mídia ${piece.code} ausente`);
    if (piece.type === "audio" && !piece.script) throw new Error(`roteiro ${piece.code} ausente`);
    if (piece.type === "interactive" && !Array.isArray(piece.payload.buttons)) {
      throw new Error(`botões ${piece.code} ausentes`);
    }
  }
  for (const video of SEVEN_DAY_CONDITIONAL_VIDEOS) {
    if (!video.asset || !video.payload.media_ref) throw new Error("vídeo oficial sem mídia");
  }
}

validateSevenDayContent();
