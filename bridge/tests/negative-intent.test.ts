import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { isNegativeIntent } from "../shared/negative-intent.ts";

Deno.test("reconhece recusa explícita com variações de acento", () => {
  assertEquals(isNegativeIntent("Não tenho interesse"), true);
  assertEquals(isNegativeIntent("SEM INTERESSE"), true);
  assertEquals(isNegativeIntent("Pare de enviar, por favor"), true);
  assertEquals(isNegativeIntent("sair da lista"), true);
});

Deno.test("não transforma qualquer frase com não em recusa", () => {
  assertEquals(isNegativeIntent("Não quero atrapalhar"), false);
  assertEquals(isNegativeIntent("Não sei o preço"), false);
  assertEquals(isNegativeIntent("O senhor não planta?"), false);
});
