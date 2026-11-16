/** Exporta a régua restaurada para edição controlada no workflow n8n. */
import { FASES } from "../bridge/handlers/funil-enroll.ts";

const pieces = FASES.flatMap((makePhase, phaseIndex) =>
  makePhase().map((piece) => {
    const day = phaseIndex + 1;
    const common = { day, offset_seconds: piece.offset };
    switch (piece.kind) {
      case "text":
        return { ...common, type: "text", payload: { content: piece.text } };
      case "text_sequence":
        return { ...common, type: "text_sequence", payload: { texts: piece.texts } };
      case "interactive":
        return {
          ...common,
          type: "interactive",
          payload: {
            text: piece.text,
            buttons: piece.buttons,
            ...(piece.headerSlot
              ? { header_media_ref: { day: piece.mediaDay ?? day, slot: piece.headerSlot } }
              : {}),
          },
        };
      case "list":
        return {
          ...common,
          type: "list",
          payload: {
            text: piece.text,
            button_label: piece.buttonLabel,
            sections: piece.sections,
          },
        };
      case "media":
        return {
          ...common,
          type: piece.mediaType,
          payload: {
            media_ref: { day: piece.mediaDay ?? day, slot: piece.slot },
            ...(piece.caption ? { caption: piece.caption } : {}),
          },
        };
    }
  })
);

if (pieces.length !== 31) throw new Error(`Régua inesperada: ${pieces.length} peças`);
console.log(JSON.stringify(pieces, null, 2));
