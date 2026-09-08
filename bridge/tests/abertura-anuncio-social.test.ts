import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isDefaultAdMessage, pareceAberturaComercial } from "../shared/ad-lead.ts";

// O Facebook e o Instagram oferecem perguntas prontas no anúncio, e o lead escolhe uma em vez
// de escrever. Em 03-08/09, 15 das 35 conversas sociais abriram assim — e NENHUMA casava com
// isDefaultAdMessage, que só conhece o texto genérico antigo. O bot respondia e o funil nunca
// começava: 10 dos 15 leads ficaram sem sequência.

Deno.test("as três aberturas reais de setembro são reconhecidas", () => {
  for (const frase of [
    "Qual é o custo da semente por hectare?",
    "Qual é o preço das sementes?",
    "Vocês oferecem entrega em todo o Brasil?",
  ]) {
    assertEquals(pareceAberturaComercial(frase), true, frase);
    assertEquals(
      isDefaultAdMessage(frase),
      false,
      "o reconhecedor antigo não pegava nenhuma — é por isso que o funil não começava",
    );
  }
});

Deno.test("variações que ainda não vimos também passam", () => {
  // A lista de frases exatas envelhece a cada campanha; a decisão é por intenção.
  for (const frase of [
    "bom dia, quanto sai o pacote de 10 kg?",
    "qual o valor?",
    "tem frete pro Mato Grosso?",
    "me passa um orçamento",
  ]) {
    assertEquals(pareceAberturaComercial(frase), true, frase);
  }
});

Deno.test("conversa que não é comercial não entra no funil", () => {
  for (const frase of [
    "oi",
    "bom dia",
    "quanto tempo demora a germinação?",
    "obrigado, era só isso",
  ]) {
    assertEquals(pareceAberturaComercial(frase), false, frase);
  }
});

// Fronteira de palavra: sem ela, "valor" casaria dentro de "desvalorizado" e qualquer
// desabafo sobre mercado viraria lead de anúncio.
Deno.test("termo dentro de outra palavra não conta", () => {
  assertEquals(pareceAberturaComercial("o milho está desvalorizado"), false);
  assertEquals(pareceAberturaComercial("isso custava caro antigamente"), false);
});

Deno.test("icebreaker novo pode ser adicionado sem deploy", () => {
  assertEquals(pareceAberturaComercial("Quero saber sobre plantio direto"), false);
  assertEquals(
    pareceAberturaComercial("Quero saber sobre plantio direto", ["quero saber sobre plantio"]),
    true,
    "FUNIL_ICEBREAKERS cobre a campanha nova até o padrão ser ajustado",
  );
});

Deno.test("texto vazio nunca é abertura de anúncio", () => {
  assertEquals(pareceAberturaComercial(""), false);
  assertEquals(pareceAberturaComercial("   "), false);
});
