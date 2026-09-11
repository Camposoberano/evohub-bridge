import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recuperacaoBloqueada } from "../shared/recovery-chain.ts";

// 11/09: cinco conversas de Facebook sem template, com a janela fechada, recebiam a nota
// "Recuperação 1 não enviada" a cada rodada de 5 minutos. O bloqueio é terminal até o
// cliente escrever de novo — é o que a própria nota promete.

const H = 60 * 60 * 1000;
const agora = Date.parse("2026-09-11T16:30:00Z");

Deno.test("sem bloqueio registrado, segue a cadeia normal", () => {
  assertEquals(recuperacaoBloqueada(null, null), false);
  assertEquals(recuperacaoBloqueada(null, agora - H), false);
});

Deno.test("bloqueada e o cliente nunca escreveu: não tenta de novo", () => {
  assertEquals(recuperacaoBloqueada(agora - 5 * 60_000, null), true);
});

Deno.test("bloqueada e o cliente escreveu ANTES do bloqueio: continua bloqueada", () => {
  assertEquals(recuperacaoBloqueada(agora - H, agora - 3 * H), true);
});

Deno.test("cliente escreveu DEPOIS do bloqueio: a janela reabriu, tenta de novo", () => {
  assertEquals(recuperacaoBloqueada(agora - 3 * H, agora - H), false);
});
