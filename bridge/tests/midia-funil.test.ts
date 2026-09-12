import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decidirSemMidia,
  limparCacheMidia,
  midiaDisponivel,
  urlDaPeca,
} from "../shared/midia-funil.ts";

// 08/09: a biblioteca do funil foi apagada e 24 dos 64 arquivos ativos passaram a devolver
// HTTP 400. A Meta recusava a peça inteira e, no Facebook/Instagram, a legenda saía duas
// vezes. Estes testes prendem o comportamento que substitui isso.

Deno.test("imagem e vídeo sem arquivo viram a legenda, uma vez só", () => {
  assertEquals(decidirSemMidia("image", { caption: "🌿 Mega Sorgo" }), {
    acao: "texto",
    conteudo: "🌿 Mega Sorgo",
  });
  assertEquals(decidirSemMidia("video", { caption: "VÍDEO 01" }), {
    acao: "texto",
    conteudo: "VÍDEO 01",
  });
});

Deno.test("sem legenda não sobra mensagem: pula a peça", () => {
  assertEquals(decidirSemMidia("image", {}), { acao: "pular" });
  assertEquals(decidirSemMidia("image", { caption: "   " }), { acao: "pular" });
  assertEquals(decidirSemMidia("audio", { media_url: "x" }), { acao: "pular" });
});

Deno.test("botão perde só a imagem do topo", () => {
  assertEquals(decidirSemMidia("interactive", { header_image: "u", text: "oi" }), {
    acao: "sem-header",
  });
  assertEquals(decidirSemMidia("interactive", { text: "oi" }), null);
  assertEquals(decidirSemMidia("text", { content: "oi" }), null);
});

Deno.test("a URL conferida é a da peça", () => {
  assertEquals(urlDaPeca("image", { media_url: "u1" }), "u1");
  assertEquals(urlDaPeca("interactive", { header_image: "u2" }), "u2");
  assertEquals(urlDaPeca("text", { content: "oi" }), null);
  assertEquals(urlDaPeca("image", { media_url: "  " }), null);
});

Deno.test("400 é arquivo que sumiu; 200 e 302 existem", async () => {
  limparCacheMidia();
  assertEquals(await midiaDisponivel("a", 1000, () => Promise.resolve(400)), false);
  limparCacheMidia();
  assertEquals(await midiaDisponivel("b", 1000, () => Promise.resolve(200)), true);
  limparCacheMidia();
  assertEquals(await midiaDisponivel("c", 1000, () => Promise.resolve(302)), true);
});

// Storage fora do ar não é peça perdida — deixar de mandar por causa do nosso próprio HEAD
// seria pior que tentar e a Meta recusar.
Deno.test("erro de rede e 5xx não bloqueiam o envio", async () => {
  limparCacheMidia();
  assertEquals(await midiaDisponivel("d", 1000, () => Promise.reject(new Error("timeout"))), true);
  limparCacheMidia();
  assertEquals(await midiaDisponivel("e", 1000, () => Promise.resolve(503)), true);
});

Deno.test("cache evita um HEAD por contato, e expira", async () => {
  limparCacheMidia();
  let chamadas = 0;
  const buscar = () => {
    chamadas++;
    return Promise.resolve(400);
  };
  assertEquals(await midiaDisponivel("f", 1000, buscar), false);
  assertEquals(await midiaDisponivel("f", 2000, buscar), false);
  assertEquals(chamadas, 1);
  // passados os 5 min do cache negativo, confere de novo (o arquivo pode ter voltado)
  assertEquals(await midiaDisponivel("f", 1000 + 6 * 60_000, buscar), false);
  assertEquals(chamadas, 2);
});

Deno.test("URL vazia não é mídia disponível", async () => {
  limparCacheMidia();
  assertEquals(await midiaDisponivel("", 1000, () => Promise.resolve(200)), false);
});
