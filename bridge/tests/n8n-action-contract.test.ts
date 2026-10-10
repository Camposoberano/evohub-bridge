import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  actionKey,
  actionUuid,
  isSoberanoAction,
  SOBERANO_ACTIONS,
} from "../shared/n8n-action-contract.ts";

Deno.test("cada macro comercial tem uma ação n8n própria", () => {
  assertEquals(SOBERANO_ACTIONS, [
    "funil", "preco", "video", "plantio", "nutricao",
    "recuperacao-1", "recuperacao-2", "recuperacao-3", "recuperacao-4",
    "catalogo", "catalogo-sair", "pause", "resume", "stop",
  ]);
  assertEquals(SOBERANO_ACTIONS.every(isSoberanoAction), true);
  assertEquals(isSoberanoAction("funil-curto"), false);
  assertEquals(isSoberanoAction("marcar-pago"), false);
});

Deno.test("IDs das peças sobrevivem a repetição e são UUIDs distintos", async () => {
  const one = await actionUuid("soberano-action:3509:funil:evento-1:0");
  assertEquals(one, await actionUuid("soberano-action:3509:funil:evento-1:0"));
  assertEquals(one === await actionUuid("soberano-action:3509:funil:evento-1:1"), false);
  assertEquals(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(one), true);
});

Deno.test("nova tentativa mantém a chave da ação", () => {
  const request = {
    request_id: "cw-label-event-3509-123",
    source: "macro" as const,
    chatwoot_conversation_id: 3509,
    action: "funil" as const,
    funnel_version: "mega-sorgo-5895-20260930",
  };
  assertEquals(actionKey(request), actionKey({ ...request }));
  assertEquals(actionKey(request) === actionKey({ ...request, request_id: "outro-evento" }), false);
});
