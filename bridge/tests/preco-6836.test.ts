import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { PRECO_6836_PACOTES } from "../handlers/hub-webhook.ts";

Deno.test("preço do 6836 usa quatro pacotes e valores informados pelo dono", () => {
  assertEquals(PRECO_6836_PACOTES.map((pacote) => pacote.id), [
    "tam_20kg",
    "tam_10kg",
    "tam_4kg",
    "tam_2kg",
  ]);
  const expected = [
    ["4 hectares", "R$ 1.437,90", "20% de desconto"],
    ["2 hectares", "R$ 764,15", "15% de desconto"],
    ["1 hectare", "R$ 341,62", "Frete grátis"],
    ["0,5 hectare", "R$ 179,90", "Frete grátis"],
  ];
  for (const [index, fields] of expected.entries()) {
    for (const field of fields) {
      assertStringIncludes(PRECO_6836_PACOTES[index].legenda, field);
    }
    assertEquals(/setembro de 2026|promoção safra 2026/i.test(PRECO_6836_PACOTES[index].legenda), false);
  }
});
