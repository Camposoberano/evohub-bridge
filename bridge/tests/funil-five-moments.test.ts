import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FASES } from "../handlers/funil-enroll.ts";

Deno.test("funil ativo tem cinco momentos com uma mensagem de texto cada", () => {
  assertEquals(FASES.length, 5);
  const momentos = FASES.map((fase) => fase());
  assertEquals(momentos.map((fase) => fase.length), [1, 1, 1, 1, 1]);
  assertEquals(momentos.flatMap((fase) => fase.map((peca) => peca.kind)), [
    "text",
    "text",
    "text",
    "text",
    "text",
  ]);
  assertEquals(
    momentos.flatMap((fase) => fase).filter((peca) =>
      "opening" in peca && peca.opening
    ).length,
    0,
  );
  const copy = momentos.flatMap((fase) => fase).map((peca) =>
    peca.kind === "text" ? peca.text : ""
  ).join("\n");
  assertEquals(/R\$|\b\d+(?:[.,]\d+)?\s*%/i.test(copy), false);
  assertEquals(
    /30%|desconto|frete grátis|produtividade|resistente à seca/i.test(copy),
    false,
  );
  assertEquals(copy.includes("1 hectare corresponde a 4 kg"), true);
});
