import { deferBackground } from "../handlers/chatwoot-webhook.ts";

function assertOrder(actual: string[], expected: string[]) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`ordem inesperada: ${JSON.stringify(actual)}`);
  }
}

Deno.test("chatwoot callback adia trabalho para responder antes do envio", async () => {
  const order: string[] = [];

  deferBackground(() => {
    order.push("background");
  });
  order.push("response");

  assertOrder(order, ["response"]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertOrder(order, ["response", "background"]);
});
