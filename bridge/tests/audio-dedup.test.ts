import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { caminhoDoAudio, ehObjetoJaExistente } from "../shared/audio.ts";

// O funil manda os MESMOS áudios para todo lead. Com nome sorteado, cada envio virava um
// objeto novo: 43 áudios distintos ocupavam 9.552 arquivos e 4,59 GB em três meses — um
// único áudio de 1 MB tinha 907 cópias. O nome derivado do conteúdo é o que corta isso.

const bytes = (s: string) => new TextEncoder().encode(s);

Deno.test("mesmo áudio sempre no mesmo caminho", async () => {
  const a = await caminhoDoAudio(bytes("conteudo-do-audio-1"));
  const b = await caminhoDoAudio(bytes("conteudo-do-audio-1"));
  assertEquals(a, b, "se variasse, cada envio subiria uma cópia — era o defeito");
});

Deno.test("áudios diferentes não colidem", async () => {
  const a = await caminhoDoAudio(bytes("audio-preco"));
  const b = await caminhoDoAudio(bytes("audio-plantio"));
  assertNotEquals(a, b, "colisão entregaria o áudio errado ao cliente");
});

Deno.test("caminho continua sob ptt/ e com extensão ogg", async () => {
  const p = await caminhoDoAudio(bytes("x"));
  assertEquals(p.startsWith("ptt/"), true);
  assertEquals(p.endsWith(".ogg"), true);
  assertEquals(p.length, "ptt/".length + 64 + ".ogg".length, "SHA-256 em hex = 64 chars");
});

// Do segundo envio em diante o upload COLIDE. Se isso contasse como falha, o áudio deixaria
// de ser enviado justamente no caso comum.
Deno.test("colisão de objeto existente é reaproveitamento, não erro", () => {
  assertEquals(ehObjetoJaExistente({ message: "The resource already exists" }), true);
  assertEquals(ehObjetoJaExistente({ message: "Duplicate", statusCode: "409" }), true);
  assertEquals(ehObjetoJaExistente({ statusCode: 409 }), true);
});

Deno.test("erro de verdade continua sendo erro", () => {
  assertEquals(ehObjetoJaExistente({ message: "Payload too large", statusCode: "413" }), false);
  assertEquals(ehObjetoJaExistente({ message: "permission denied", statusCode: "403" }), false);
  assertEquals(ehObjetoJaExistente(null), false);
  assertEquals(ehObjetoJaExistente(undefined), false);
});
