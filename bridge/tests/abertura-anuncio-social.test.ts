import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isDefaultAdMessage, pareceAberturaComercial } from "../shared/ad-lead.ts";
import { socialLeadEntry } from "../shared/social-lead-entry.ts";

const openedAt = "2026-10-11T14:00:00.000Z";
const nowMs = Date.parse("2026-10-11T14:01:00.000Z");

Deno.test("referência Meta inscreve independentemente do texto ou do anexo", () => {
  assertEquals(socialLeadEntry({ hasReferral: true, persistedAdOrigin: false, inboundCount: 1, openedAt, text: "", nowMs }), "ad_referral");
  assertEquals(socialLeadEntry({ hasReferral: true, persistedAdOrigin: false, inboundCount: 2, openedAt, text: "oi", nowMs }), "ad_referral");
});

Deno.test("pergunta comercial após anexo inicial entra até a terceira mensagem em cinco minutos", () => {
  const base = { hasReferral: false, persistedAdOrigin: false, openedAt, text: "qual o preço?", nowMs };
  assertEquals(socialLeadEntry({ ...base, inboundCount: 2 }), "commercial_fallback");
  assertEquals(socialLeadEntry({ ...base, inboundCount: 3 }), "commercial_fallback");
  assertEquals(socialLeadEntry({ ...base, inboundCount: 4 }), null);
  assertEquals(socialLeadEntry({ ...base, inboundCount: 2, nowMs: nowMs + 5 * 60_000 }), null);
  assertEquals(socialLeadEntry({ ...base, inboundCount: 1, text: "[anexo]" }), null);
});

Deno.test("conversa antiga ou sem abertura confiável não entra", () => {
  const base = { hasReferral: true, persistedAdOrigin: false, inboundCount: 1, text: "oi", nowMs };
  assertEquals(socialLeadEntry({ ...base, openedAt: "2026-10-10T14:00:00.000Z" }), null);
  assertEquals(socialLeadEntry({ ...base, openedAt: null }), null);
});

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
