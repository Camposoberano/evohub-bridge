import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  actionWebhookUrl,
  dispatchSoberanoAction,
  enabledN8nActions,
} from "../shared/n8n-action-router.ts";
import type { ActionRequest } from "../shared/n8n-action-contract.ts";

Deno.test("produção usa todas as ações do n8n sem fallback de conteúdo local", () => {
  assertEquals(enabledN8nActions().size, 14);
  assertEquals([...enabledN8nActions("funil,preco,invalida")], ["funil", "preco"]);
  assertEquals([...enabledN8nActions("")], []);
});

Deno.test("cada ação tem webhook estável na instância Soberano", () => {
  assertEquals(
    actionWebhookUrl("funil", "https://automacao.soberano.pro/home/workflows"),
    "https://automacao.soberano.pro/webhook/soberano-5895-funil",
  );
  assertEquals(
    actionWebhookUrl("preco", "https://automacao.soberano.pro"),
    "https://automacao.soberano.pro/webhook/soberano-5895-preco",
  );
});

// O webhook do n8n é fire-and-forget: muitas vezes responde 200 com corpo vazio (sem nó
// "Respond to Webhook"). Isso DEVE contar como despachado — exigir {ok:true,accepted:N}
// travava a macro pra sempre. Falha só quando o n8n sinaliza explicitamente.
const REQ: ActionRequest = {
  request_id: "test-1",
  source: "macro",
  chatwoot_conversation_id: 123,
  action: "plantio",
  funnel_version: "mega-sorgo-5895-20260930",
};
const fakeSend = (body: string, status = 200): typeof fetch =>
  (() => Promise.resolve(new Response(body, { status }))) as unknown as typeof fetch;

Deno.test("n8n 200 com corpo vazio conta como despachado", async () => {
  Deno.env.set("SOBERANO_N8N_WEBHOOK_SECRET", "x");
  Deno.env.set("SOBERANO_N8N_BASE_URL", "https://automacao.soberano.pro");
  assertEquals(await dispatchSoberanoAction(REQ, fakeSend("")), {
    ok: true,
    accepted: 0,
    duplicate: false,
  });
});

Deno.test("n8n no contrato usa a contagem reportada", async () => {
  Deno.env.set("SOBERANO_N8N_WEBHOOK_SECRET", "x");
  Deno.env.set("SOBERANO_N8N_BASE_URL", "https://automacao.soberano.pro");
  assertEquals(
    await dispatchSoberanoAction(
      REQ,
      fakeSend(JSON.stringify({ ok: true, accepted: 3 })),
    ),
    { ok: true, accepted: 3, duplicate: false },
  );
});

Deno.test("falha explícita do n8n continua sendo falha (terminal preservado)", async () => {
  Deno.env.set("SOBERANO_N8N_WEBHOOK_SECRET", "x");
  Deno.env.set("SOBERANO_N8N_BASE_URL", "https://automacao.soberano.pro");
  assertEquals(
    await dispatchSoberanoAction(
      REQ,
      fakeSend(JSON.stringify({ ok: false, terminal: true, error: "janela-fechada" })),
    ),
    { ok: false, terminal: true, error: "janela-fechada" },
  );
});

Deno.test("HTTP não-2xx é falha com o status no erro", async () => {
  Deno.env.set("SOBERANO_N8N_WEBHOOK_SECRET", "x");
  Deno.env.set("SOBERANO_N8N_BASE_URL", "https://automacao.soberano.pro");
  const r = await dispatchSoberanoAction(REQ, fakeSend("", 500));
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, "n8n HTTP 500");
});
