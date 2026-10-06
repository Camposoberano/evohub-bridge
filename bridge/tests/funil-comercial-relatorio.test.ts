import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { summarizeFunilComercial } from "../shared/funil-comercial-relatorio.ts";

Deno.test("relatório separa intenção, prova, cotação, humano e venda validada", () => {
  const summary = summarizeFunilComercial([
    { event_type: "intencao_identificada", channel_id: "wa", received_at: "2026-10-01T12:00:00Z", payload: { conversation_id: "c1", message_id: "m0", intent: "preco", origin: "cliente" } },
    { event_type: "uso_informado", channel_id: "wa", received_at: "2026-10-01T12:01:00Z", payload: { conversation_id: "c1", uso: "silagem" } },
    { event_type: "prova_enviada", channel_id: "wa", received_at: "2026-10-01T12:02:00Z", payload: { conversation_id: "c1", message_id: "m1" } },
    { event_type: "intencao_identificada", channel_id: "wa", received_at: "2026-10-01T12:02:30Z", payload: { conversation_id: "c1", message_id: "m1b", intent: "preco", origin: "cliente" } },
    { event_type: "commercial_funnel_enrolled_v2", received_at: "2026-10-01T11:59:00Z", payload: {} },
    { event_type: "human_response", channel_id: "wa", received_at: "2026-10-01T12:05:00Z", payload: { conversation_id: "c1", message_id: "m3" } },
    { event_type: "cotacao_solicitada", channel_id: "wa", received_at: "2026-10-01T12:03:00Z", payload: { conversation_id: "c1", message_id: "m2" } },
  ], [
    { id: "c1", outcome: "won", outcome_value_cents: 12_500 },
    { id: "c2", outcome: "open", outcome_value_cents: 99_000 },
  ], 2);

  assertEquals(summary.intents, 2);
  assertEquals(summary.uses, 1);
  assertEquals(summary.proofs, 1);
  assertEquals(summary.responsesAfterProof, 1);
  assertEquals(summary.quotes, 1);
  assertEquals(summary.humanResponses, 1);
  assertEquals(summary.byChannel[0].responsesAfterProof, 1);
  assertEquals(summary.firstHumanResponsesAfterQuote, 1);
  assertEquals(summary.won, 1);
  assertEquals(summary.open, 0); // conversas sem evento comercial não entram no corte
  assertEquals(summary.revenueCents, 12_500);
  assertEquals(summary.funnelMessagesWithoutScheduleLink, 2);
  assertEquals(summary.attributionIncomplete, 1); // pedido de uso sem message_id
});

Deno.test("open nunca vira venda e canal sem conversa aparece como atribuição incompleta", () => {
  const summary = summarizeFunilComercial([
    { event_type: "cotacao_solicitada", channel_id: "ig", received_at: "2026-10-01T12:00:00Z", payload: { conversation_id: "c1", message_id: "m1" } },
    { event_type: "pedido_atendimento", received_at: "2026-10-01T12:01:00Z", payload: {} },
  ], [{ id: "c1", outcome: "open", outcome_value_cents: 50_000 }]);
  assertEquals(summary.won, 0);
  assertEquals(summary.open, 1);
  assertEquals(summary.revenueCents, 0);
  assertEquals(summary.attributionIncomplete, 1);
});
