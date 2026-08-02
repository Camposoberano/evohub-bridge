import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isUnmappedMsgType, normalizeMsgType } from "../shared/msg-type.ts";

Deno.test("tipos ja canonicos passam direto", () => {
  for (
    const t of [
      "text",
      "image",
      "audio",
      "video",
      "document",
      "sticker",
      "location",
      "contact",
      "interactive",
      "template",
      "unknown",
    ]
  ) {
    assertEquals(normalizeMsgType(t), t);
  }
});

Deno.test("tipos crus da uazapi/Baileys mapeiam pro enum", () => {
  assertEquals(normalizeMsgType("conversation"), "text");
  assertEquals(normalizeMsgType("extendedTextMessage"), "text");
  assertEquals(normalizeMsgType("imageMessage"), "image");
  assertEquals(normalizeMsgType("audioMessage"), "audio");
  assertEquals(normalizeMsgType("ptt"), "audio");
  assertEquals(normalizeMsgType("videoMessage"), "video");
  assertEquals(normalizeMsgType("documentMessage"), "document");
  assertEquals(normalizeMsgType("documentWithCaptionMessage"), "document");
  assertEquals(normalizeMsgType("stickerMessage"), "sticker");
  assertEquals(normalizeMsgType("locationMessage"), "location");
  assertEquals(normalizeMsgType("liveLocationMessage"), "location");
  assertEquals(normalizeMsgType("contactMessage"), "contact");
  assertEquals(normalizeMsgType("contactsArrayMessage"), "contact");
  assertEquals(normalizeMsgType("listResponseMessage"), "interactive");
  assertEquals(normalizeMsgType("buttonsResponseMessage"), "interactive");
  assertEquals(normalizeMsgType("templateButtonReplyMessage"), "interactive");
});

Deno.test("tipos da Meta oficial mapeiam pro enum", () => {
  assertEquals(normalizeMsgType("contacts"), "contact");
  assertEquals(normalizeMsgType("button"), "interactive");
});

Deno.test("case e whitespace nao importam", () => {
  assertEquals(normalizeMsgType("  ImageMessage  "), "image");
  assertEquals(normalizeMsgType("PTT"), "audio");
});

Deno.test("tipo vazio ou nulo vira unknown sem contar como nao-mapeado", () => {
  assertEquals(normalizeMsgType(""), "unknown");
  assertEquals(normalizeMsgType(null), "unknown");
  assertEquals(normalizeMsgType(undefined), "unknown");
  assertEquals(isUnmappedMsgType(""), false);
  assertEquals(isUnmappedMsgType(null), false);
});

Deno.test("tipo conhecido sem coluna no enum fica unknown de proposito", () => {
  assertEquals(normalizeMsgType("reactionMessage"), "unknown");
  assertEquals(normalizeMsgType("protocolMessage"), "unknown");
  assertEquals(isUnmappedMsgType("reactionMessage"), false);
});

Deno.test("tipo genuinamente desconhecido fica unknown e marca pra diagnostico", () => {
  assertEquals(normalizeMsgType("algumTipoNovoDoWhatsapp"), "unknown");
  assertEquals(isUnmappedMsgType("algumTipoNovoDoWhatsapp"), true);
});

Deno.test("nao corta pedaco de palavra que nao e sufixo message/msg", () => {
  // "message" no meio (nao no fim) nao deve ser removido silenciosamente.
  assertEquals(normalizeMsgType("messageContextInfo"), "unknown");
  assertEquals(isUnmappedMsgType("messageContextInfo"), true);
});
