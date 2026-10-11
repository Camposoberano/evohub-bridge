import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { queueBaseVersion } from "../handlers/n8n-queue.ts";

Deno.test("a fila n8n reconhece somente versões publicadas e ações derivadas", () => {
  assertEquals(queueBaseVersion("mega-sorgo-5895-20260930"), "mega-sorgo-5895-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-5895-20260930:preco"), "mega-sorgo-5895-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-social-20260930"), "mega-sorgo-social-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-social-20260930:video"), "mega-sorgo-social-20260930");
  assertEquals(queueBaseVersion("mega-sorgo-social-20260930-extra"), null);
  assertEquals(queueBaseVersion("mega-sorgo"), null);
});
