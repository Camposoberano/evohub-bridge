import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  actionWebhookUrl,
  enabledN8nActions,
} from "../shared/n8n-action-router.ts";

Deno.test("uma flag por ação preserva a migração gradual", () => {
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
