import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveRyzeRouting } from "../handlers/ryzeapi-webhook.ts";

const ownDigits = "556699361723";
const customerDigits = "558896969606";

Deno.test("Ryze mantém mensagem recebida no lado do cliente", () => {
  assertEquals(
    resolveRyzeRouting({
      direction: "incoming",
      source: "",
      ownDigits,
      senderDigits: customerDigits,
      chatDigits: customerDigits,
      recipientDigits: "",
    }),
    { from: customerDigits, outgoing: false },
  );
});

Deno.test("Ryze coloca saída do aparelho no lado do atendente", () => {
  assertEquals(
    resolveRyzeRouting({
      direction: "outgoing",
      source: "",
      ownDigits,
      senderDigits: ownDigits,
      chatDigits: customerDigits,
      recipientDigits: customerDigits,
    }),
    { from: customerDigits, outgoing: true },
  );
});

Deno.test("Ryze ignora eco de saída enviada pela API", () => {
  assertEquals(
    resolveRyzeRouting({
      direction: "outgoing",
      source: "api",
      ownDigits,
      senderDigits: ownDigits,
      chatDigits: customerDigits,
      recipientDigits: customerDigits,
    }),
    null,
  );
});
