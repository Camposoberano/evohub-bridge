import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isNumeroDaCasa, normalizarNumero } from "../handlers/uazapi-webhook.ts";

// O alerta operacional sai do 5895 para o 11910 — e o 11910 é canal nosso, escutado pela
// uazapi. Sem esta guarda o alerta vira "mensagem de cliente", aciona o bot de intenção,
// que responde para o 5895, que ingere de volta: laço entre dois números da casa.

function dbComCanais(numeros: string[]) {
  return {
    from: () => ({
      select: () =>
        Promise.resolve({ data: numeros.map((n) => ({ phone_number: n })) }),
    }),
  };
}

Deno.test("normaliza número para só dígitos", () => {
  assertEquals(normalizarNumero("+55 11 91036-3320"), "5511910363320");
  assertEquals(normalizarNumero(""), "");
});

Deno.test("número de canal próprio é reconhecido, em qualquer formatação", async () => {
  const db = dbComCanais(["+55 11 91036-3320", "+55 19 99971-5895"]);
  assertEquals(await isNumeroDaCasa(db as never, "5511910363320"), true);
  assertEquals(await isNumeroDaCasa(db as never, "+55 19 99971-5895"), true);
});

Deno.test("número de cliente não é confundido com número da casa", async () => {
  const db = dbComCanais(["+55 11 91036-3320"]);
  assertEquals(await isNumeroDaCasa(db as never, "5566993617230"), false);
  assertEquals(await isNumeroDaCasa(db as never, ""), false);
});
