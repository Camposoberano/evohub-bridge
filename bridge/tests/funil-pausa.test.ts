import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chaveDaPausa, podeRetomar, vencidas } from "../shared/funil-pausa.ts";

// Pedir preço é o maior sinal de compra que o lead dá — e era o que o tirava da sequência.
// `autoPauseFunil` era chamado para qualquer intenção comercial, a pausa não tinha prazo e
// nada a retomava: em 10/09 havia 3.555 peças e 144 sequências paradas assim, mais de
// duzentas acumuladas num único dia.

const marcador = (id: string, horasAtras: number, agora: number) => ({
  delivery_id: chaveDaPausa(id),
  received_at: new Date(agora - horasAtras * 3_600_000).toISOString(),
});

const AGORA = Date.parse("2026-09-10T20:00:00Z");

Deno.test("vence no prazo, não antes", () => {
  const lista = [marcador("conv-23h", 23, AGORA), marcador("conv-25h", 25, AGORA)];
  assertEquals(vencidas(lista, AGORA, 24), ["conv-25h"]);
});

Deno.test("exatamente no prazo já conta como vencida", () => {
  assertEquals(vencidas([marcador("conv", 24, AGORA)], AGORA, 24), ["conv"]);
});

Deno.test("devolve o id da conversa, sem o prefixo do marcador", () => {
  const id = "a1b2c3d4-0000-4444-8888-abcdefabcdef";
  assertEquals(vencidas([marcador(id, 48, AGORA)], AGORA, 24), [id]);
});

// Data ilegível não pode virar retomada: melhor a conversa seguir parada do que voltar na
// hora errada, no meio de uma negociação.
Deno.test("marcador com data quebrada não vence", () => {
  const lista = [{ delivery_id: chaveDaPausa("conv"), received_at: "não é data" }];
  assertEquals(vencidas(lista, AGORA, 24), []);
});

Deno.test("lista vazia não quebra", () => {
  assertEquals(vencidas([], AGORA, 24), []);
});

// Retomar em cima de quem já comprou é pior que não retomar: a sequência de APRESENTAÇÃO
// chegaria para alguém que já é cliente.
Deno.test("quem fechou negócio não volta para o funil", () => {
  assertEquals(podeRetomar({ outcome: "won" }), false);
  assertEquals(podeRetomar({ outcome: "lost" }), false);
});

Deno.test("bot travado à mão vence a retomada automática", () => {
  assertEquals(
    podeRetomar({ outcome: "open", bot_muted_at: "2026-09-09T12:00:00Z" }),
    false,
    "a etiqueta bot-off é decisão de um atendente e não pode ser desfeita por um laço",
  );
});

Deno.test("conversa aberta e sem trava volta ao funil", () => {
  assertEquals(podeRetomar({ outcome: "open", bot_muted_at: null }), true);
  assertEquals(podeRetomar({ outcome: null }), true);
});

Deno.test("conversa inexistente não é retomada", () => {
  assertEquals(podeRetomar(null), false);
});
