import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canalAlvoFunil,
  deveAdiarPausaDaAbertura,
  deveEncaminharPerguntaDeAnuncio,
  deveIgnorarInscricaoHistorica,
  inscricaoPrecisaDeRecuperacao,
  motivoEntradaAnuncio,
  suprimirAberturaGenerica,
  usaNovoFunilNoCanal,
} from "../shared/funil-anuncio.ts";

Deno.test("identifica 5895 por nome, ID ou final do telefone", () => {
  assertEquals(canalAlvoFunil({ name: "Campo Soberano 5895" }), true);
  assertEquals(canalAlvoFunil({ external_id: "5895" }), true);
  assertEquals(canalAlvoFunil({ phone_number: "+55 19 99971-5895" }), true);
});

Deno.test("canal 5895 nunca volta à abertura antiga de duas mensagens", () => {
  assertEquals(usaNovoFunilNoCanal({ name: "Campo Soberano 5895" }), true);
  assertEquals(usaNovoFunilNoCanal({ name: "Campo Soberano 6836" }), false);
});

Deno.test("não inclui outro canal nem corresponde pelo WABA", () => {
  assertEquals(canalAlvoFunil({ name: "Campo Soberano 6836" }), false);
  assertEquals(canalAlvoFunil({ phone_number: "+55 19 99971-6836" }), false);
  assertEquals(canalAlvoFunil({ phone_number_id: "5895" }), false);
  assertEquals(canalAlvoFunil({ name: "5895" }, ""), false);
});

Deno.test("referral e origem persistida vencem intenção comercial", () => {
  assertEquals(
    motivoEntradaAnuncio({
      fromAd: true,
      origemPersistida: false,
      mensagemPadrao: false,
      palavraConfigurada: false,
      aberturaSocial: false,
      intencaoComercial: true,
    }),
    "meta-referral",
  );
  assertEquals(
    motivoEntradaAnuncio({
      fromAd: false,
      origemPersistida: true,
      mensagemPadrao: false,
      palavraConfigurada: false,
      aberturaSocial: false,
      intencaoComercial: true,
    }),
    "origem-persistida",
  );
});

Deno.test("texto fallback só inscreve com evidência positiva configurada", () => {
  const base = {
    fromAd: false,
    origemPersistida: false,
    mensagemPadrao: false,
    palavraConfigurada: false,
    aberturaSocial: false,
    intencaoComercial: false,
  };
  assertEquals(motivoEntradaAnuncio(base), null);
  assertEquals(
    motivoEntradaAnuncio({ ...base, palavraConfigurada: true }),
    "palavra-configurada",
  );
  assertEquals(
    motivoEntradaAnuncio({ ...base, mensagemPadrao: true }),
    "mensagem-padrao",
  );
});

Deno.test("abertura social não engole intenção já reconhecida", () => {
  const base = {
    fromAd: false,
    origemPersistida: false,
    mensagemPadrao: false,
    palavraConfigurada: false,
    aberturaSocial: true,
  };
  assertEquals(
    motivoEntradaAnuncio({ ...base, intencaoComercial: true }),
    null,
  );
  assertEquals(
    motivoEntradaAnuncio({ ...base, intencaoComercial: false }),
    "abertura-social",
  );
});

Deno.test("intenção direta substitui a abertura genérica", () => {
  assertEquals(suprimirAberturaGenerica(true), true);
  assertEquals(suprimirAberturaGenerica(false), false);
});

Deno.test("resposta direta pausa o lead de anúncio sem travar na primeira etapa", () => {
  assertEquals(deveAdiarPausaDaAbertura(true, true), false);
  assertEquals(deveAdiarPausaDaAbertura(true, false), true);
  assertEquals(deveAdiarPausaDaAbertura(false, true), false);
});

Deno.test("não reinscreve conversa histórica sem sequência", () => {
  assertEquals(deveIgnorarInscricaoHistorica(false, 2), true);
  assertEquals(deveIgnorarInscricaoHistorica(false, 1), false);
  assertEquals(deveIgnorarInscricaoHistorica(true, 5), false);
  assertEquals(
    deveIgnorarInscricaoHistorica(false, 5, "2026-10-05T23:59:00-03:00"),
    true,
  );
  assertEquals(
    deveIgnorarInscricaoHistorica(false, 5, "2026-10-07T13:00:00-03:00"),
    false,
  );
});

Deno.test("pergunta da saudação do anúncio não pausa o funil restaurado", () => {
  assertEquals(
    deveEncaminharPerguntaDeAnuncio("mega-sorgo-5895-20260930", true),
    false,
  );
  assertEquals(deveEncaminharPerguntaDeAnuncio("mega-sorgo", true), true);
});

Deno.test("recupera só sequência ativa sem fila e sem evento de sucesso", () => {
  assertEquals(inscricaoPrecisaDeRecuperacao("running", false, false), true);
  assertEquals(inscricaoPrecisaDeRecuperacao("paused", false, false), false);
  assertEquals(inscricaoPrecisaDeRecuperacao("running", true, false), false);
  assertEquals(inscricaoPrecisaDeRecuperacao("running", false, true), false);
});
