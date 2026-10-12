import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchingReceipt, uniqueConfirmedReceipt } from "../shared/reconcile-5895.ts";

const at = Date.parse("2026-10-12T12:00:00Z");
const row = { type: "video", payload: { media_url: "https://example.test/video.mp4" } };
const receipt = {
  fromMe: true,
  messageTimestamp: at + 20_000,
  messageType: "videoMessage",
  sendPayload: { file: row.payload.media_url },
  status: "Delivered",
};

Deno.test("reconciliação aceita somente recibo confirmado da mesma mídia na janela da tentativa", () => {
  assertEquals(matchingReceipt(row, receipt, at), true);
  assertEquals(matchingReceipt(row, { ...receipt, status: "Sent" }, at), false);
  assertEquals(matchingReceipt(row, { ...receipt, fromMe: false }, at), false);
  assertEquals(matchingReceipt(row, { ...receipt, messageTimestamp: at + 181_000 }, at), false);
  assertEquals(matchingReceipt(row, { ...receipt, sendPayload: { file: "other" } }, at), false);
});

Deno.test("reconciliação exige texto exato para interação e aceita leitura", () => {
  const interaction = { type: "interactive", payload: { text: "Escolha" } };
  assertEquals(matchingReceipt(interaction, {
    fromMe: true, messageTimestamp: at, status: "Read",
    sendPayload: { text: "Escolha" },
  }, at), true);
  assertEquals(matchingReceipt(interaction, {
    fromMe: true, messageTimestamp: at, status: "Read",
    sendPayload: { text: "Outro" },
  }, at), false);
});

Deno.test("sem recibo único, a peça permanece sem confirmação", () => {
  assertEquals(uniqueConfirmedReceipt([]).error, "receipt_missing");
  assertEquals(uniqueConfirmedReceipt([receipt, receipt]).error, "receipt_ambiguous");
  assertEquals(uniqueConfirmedReceipt([receipt]).receipt, receipt);
});
