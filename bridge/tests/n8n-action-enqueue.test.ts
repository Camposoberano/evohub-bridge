import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildActionRows,
  validateEnqueueBody,
} from "../handlers/n8n-action-enqueue.ts";

const request = {
  request_id: "inbound-3509-1",
  source: "ad" as const,
  chatwoot_conversation_id: 3509,
  action: "funil" as const,
  funnel_version: "mega-sorgo-5895-20260930",
};

Deno.test("rejeita funil curto, ação desconhecida e lote parcial", () => {
  assertEquals(validateEnqueueBody({ request: { ...request, funnel_version: "mega-sorgo-5895-v2" }, pieces: [] }).ok, false);
  assertEquals(validateEnqueueBody({ request: { ...request, action: "outra" }, pieces: [] }).ok, false);
  assertEquals(validateEnqueueBody({ request, pieces: [{ day: 1, type: "text", payload: { content: "Oi" }, offset_seconds: 0 }] }).ok, false);
});

Deno.test("mesmo evento gera as mesmas peças e mantém a ordem", async () => {
  const body = validateEnqueueBody({
    request: { ...request, action: "preco", source: "macro" },
    pieces: [
      { day: 0, type: "text", payload: { content: "Preço" }, offset_seconds: 0 },
      { day: 0, type: "image", payload: { media_url: "https://example.org/preco.jpg" }, offset_seconds: 70 },
    ],
  });
  assertEquals(body.ok, true);
  if (!body.ok) return;
  const a = await buildActionRows(body.value, "conversation-uuid", 1_760_000_000_000);
  const b = await buildActionRows(body.value, "conversation-uuid", 1_760_000_000_000);
  assertEquals(a, b);
  assertEquals(a.length, 2);
  assertEquals(a[0].status, "paused");
  assertEquals(a[1].step, 1);
  assertEquals(Date.parse(a[1].send_at) - Date.parse(a[0].send_at), 70_000);
  await assertRejects(() => buildActionRows(body.value, "", 1_760_000_000_000));
});
