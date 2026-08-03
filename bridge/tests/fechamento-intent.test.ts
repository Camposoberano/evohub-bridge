import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isComprovanteMsgType, isFechamentoIntent } from "../shared/intent.ts";

// Frases reais da conversa #798, que fechou venda em 03/08.
Deno.test("reconhece os dados que o lead manda pra fechar", () => {
  for (
    const t of [
      "Cep 47.680-00",
      "meu cep é 38400-100",
      "CPF 123.456.789-01",
      "cnpj 12.345.678/0001-90",
      "Meu endereço é rua das flores",
      "razão social Agro Silva LTDA",
      "bairro centro",
    ]
  ) {
    if (!isFechamentoIntent(t)) throw new Error(`nao reconheceu: ${t}`);
  }
});

// O risco real: CPF e celular têm 11 dígitos. Pausar o funil por causa de um telefone
// solto seria pior do que não pausar.
Deno.test("numero solto NAO dispara — evita confundir com telefone", () => {
  for (
    const t of [
      "5511999998888",
      "meu numero 11999998888",
      "47680000",
      "liga 6699361723",
    ]
  ) {
    if (isFechamentoIntent(t)) throw new Error(`falso positivo: ${t}`);
  }
});

Deno.test("conversa normal nao dispara", () => {
  for (
    const t of [
      "qual o preço",
      "quero ver os vídeos",
      "bom dia",
      "quanto tempo pra colher",
      "",
    ]
  ) {
    assertEquals(isFechamentoIntent(t), false, `falso positivo: ${t}`);
  }
});

Deno.test("documento conta como fechamento em andamento", () => {
  assertEquals(isComprovanteMsgType("document"), true);
  assertEquals(isComprovanteMsgType("DOCUMENT"), true);
  assertEquals(isComprovanteMsgType("image"), false);
  assertEquals(isComprovanteMsgType("text"), false);
  assertEquals(isComprovanteMsgType(null), false);
});
