import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { temValorOuData, textoDeAncoragem } from "../shared/ancoragem-preco.ts";

// A ancoragem responde o lead que ABRE a conversa perguntando o preço — 15 das 35 conversas
// sociais de 03-08/09 começaram assim, porque é a pergunta pronta que o anúncio oferece.
// Ela precisa responder de verdade, sem entregar o número: a semente é original e mais cara,
// e o valor solto antes de qualquer construção afasta.

Deno.test("a ancoragem não carrega valor nem data de validade", () => {
  const t = textoDeAncoragem();
  assertEquals(
    temValorOuData(t),
    false,
    "citar preço aqui anula o propósito, e data vence sem ninguém perceber",
  );
});

Deno.test("mas diz o que justifica o preço", () => {
  const t = textoDeAncoragem().toLowerCase();
  for (const termo of ["original", "frete", "desconto"]) {
    assertEquals(t.includes(termo), true, `faltou falar de ${termo}`);
  }
});

Deno.test("e promete o número em seguida, para o lead não ficar no vácuo", () => {
  const t = textoDeAncoragem().toLowerCase();
  assertEquals(
    /valor|mostro|te passo/.test(t),
    true,
    "ele perguntou o preço — precisa saber que a resposta vem",
  );
});

// Os dois erros que já custaram confiança: "30% de desconto", que não existe (os reais são
// 5%, 15% e 20%), e a "Promoção SAFRINHA — válida até 10/08/2026", enviada 120 vezes em 14
// dias com a validade vencida havia 28 dias.
Deno.test("valor e data são barrados em texto customizado", () => {
  assertEquals(temValorOuData("Pacote por R$ 899,00"), true);
  assertEquals(temValorOuData("Promoção válida até 10/08/2026"), true);
  assertEquals(temValorOuData("de R$1.798 por R$1.437"), true);
});

// Percentual NÃO é barrado: "até 20%" é verdade e é o que dá peso à ancoragem. O que quebrou
// a confiança foi o número falso, não o fato de haver um número.
Deno.test("percentual verdadeiro passa", () => {
  assertEquals(temValorOuData("o desconto chega a 20% no pacote maior"), false);
});

Deno.test("texto vazio não acusa falso positivo", () => {
  assertEquals(temValorOuData(""), false);
});
