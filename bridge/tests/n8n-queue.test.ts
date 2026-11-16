import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { queueBaseVersion, queueBlockReason, shouldCancelTerminal5895 } from "../handlers/n8n-queue.ts";

Deno.test("a fila n8n reconhece somente versões publicadas e ações derivadas", () => {
  assertEquals(queueBaseVersion("mega-sorgo-5895-20260930"), "mega-sorgo-5895-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-5895-20260930:preco"), "mega-sorgo-5895-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-social-20260930"), "mega-sorgo-social-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-social-20260930:video"), "mega-sorgo-social-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-social-20260930-extra"), null);
  assertEquals(queueBaseVersion("mega-sorgo"), null);
});

Deno.test("a fila n8n bloqueia contato, venda encerrada e atendimento humano", () => {
  assertEquals(queueBlockReason({ contacts: { attributes: { blocked: true } } }), "contato excluído");
  assertEquals(queueBlockReason({ contacts: { attributes: { automation_excluded: true } } }), "contato excluído");
  assertEquals(queueBlockReason({ outcome: "won" }), "ja-comprou");
  assertEquals(queueBlockReason({ bot_muted_at: "2026-10-12T00:00:00Z" }), "atendimento-humano");
  assertEquals(queueBlockReason({}), null);
});

Deno.test("somente desfecho terminal do 5895 cancela peça obsoleta", () => {
  assertEquals(shouldCancelTerminal5895("mega-sorgo-5895-20260930:preco", "nao-compra"), true);
  assertEquals(shouldCancelTerminal5895("mega-sorgo-5895-20260930", "ja-comprou"), true);
  assertEquals(shouldCancelTerminal5895("mega-sorgo-5895-20260930", "atendimento-humano"), false);
  assertEquals(shouldCancelTerminal5895("mega-sorgo-social-20260930", "nao-compra"), false);
  assertEquals(shouldCancelTerminal5895("mega-sorgo", "nao-compra"), false);
});
