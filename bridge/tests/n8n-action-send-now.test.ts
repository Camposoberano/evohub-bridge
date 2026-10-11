import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validImmediateRequest } from "../handlers/n8n-action-send-now.ts";

const request = {
  request_id: "funnel-conversation:123",
  source: "ad",
  chatwoot_conversation_id: 3509,
  action: "funil",
  funnel_version: "mega-sorgo-5895-20260930",
};

Deno.test("envio imediato exige ID da peça e solicitação do funil certo", () => {
  const body = {
    scheduled_message_id: "12345678-1234-8123-8123-123456789abc",
    request,
  };
  assertEquals(validImmediateRequest(body).ok, true);
  assertEquals(validImmediateRequest({ ...body, scheduled_message_id: "wrong" }).ok, false);
  assertEquals(validImmediateRequest({ ...body, request: { ...request, funnel_version: "old" } }).ok, false);
  assertEquals(validImmediateRequest({ ...body, request: { ...request, chatwoot_conversation_id: "3509" } }).ok, false);
});
