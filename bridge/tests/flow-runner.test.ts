import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { esperaVencida } from "../shared/flow-runner.ts";
import type { FlowStep } from "../shared/flow.ts";

const PERGUNTA: FlowStep = {
  id: "p",
  kind: "buttons",
  text: "leite ou corte?",
  buttons: [{ id: "leite", title: "Leite" }],
  timeoutMin: 120,
  onTimeout: "lembrete",
};

const T0 = Date.parse("2026-08-12T12:00:00.000Z");

// Quem não responde é a maioria — o funil mede de 19% a 79% de resposta por fase. Sem
// timeout o fluxo fica pendurado para sempre nesses contatos.
Deno.test("espera vence depois do timeoutMin", () => {
  const desde = new Date(T0).toISOString();
  assertEquals(esperaVencida(PERGUNTA, desde, T0 + 119 * 60_000), false);
  assertEquals(esperaVencida(PERGUNTA, desde, T0 + 120 * 60_000), true);
  assertEquals(esperaVencida(PERGUNTA, desde, T0 + 300 * 60_000), true);
});

Deno.test("step sem timeout espera indefinidamente", () => {
  const semTimeout: FlowStep = { ...PERGUNTA, timeoutMin: undefined };
  assertEquals(
    esperaVencida(semTimeout, new Date(T0).toISOString(), T0 + 999 * 60_000),
    false,
  );
});

// Defensivo: data corrompida no estado não pode fazer o fluxo avançar sozinho — seria
// mensagem indo para quem acabou de receber a anterior.
Deno.test("waitingSince ausente ou invalido nao vence", () => {
  assertEquals(esperaVencida(PERGUNTA, undefined, T0 + 999 * 60_000), false);
  assertEquals(esperaVencida(PERGUNTA, "nao-e-data", T0 + 999 * 60_000), false);
});
