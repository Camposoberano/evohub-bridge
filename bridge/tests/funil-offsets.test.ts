import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FASES, FIM_ACESSO } from "../handlers/funil-enroll.ts";

// O cron do n8n roda 1x/min e dispara tudo que venceu. Duas peças no mesmo tick saem em
// ordem imprevisível — o produtor pode receber o preço antes do áudio que o explica.
Deno.test("peças de uma fase ficam >=70s uma da outra", () => {
  FASES.forEach((fase, i) => {
    const offs = fase().map((p) => p.offset);
    for (let k = 1; k < offs.length; k++) {
      const gap = offs[k] - offs[k - 1];
      if (gap < 70) {
        throw new Error(
          `fase ${i + 1}: gap de ${gap}s entre offset ${offs[k - 1]} e ${
            offs[k]
          }`,
        );
      }
    }
  });
});

// Cada momento novo contém uma única peça no instante inicial.
Deno.test("nenhuma peça passa do teto do acesso", () => {
  FASES.forEach((fase, i) => {
    const ultimo = Math.max(...fase().map((p) => p.offset));
    if (ultimo > FIM_ACESSO) {
      throw new Error(`fase ${i + 1}: último offset ${ultimo} > ${FIM_ACESSO}`);
    }
  });
});

// A régua de anúncios tem cinco momentos individuais, sem sequência longa por momento.
Deno.test("cinco momentos são enviados individualmente", () => {
  assertEquals(FASES.length, 5);
  for (const fase of FASES) {
    const pecas = fase();
    assertEquals(pecas.length, 1);
    assertEquals(pecas[0].kind, "text");
    assertEquals(pecas[0].offset, 0);
  }
});

// Artes do catálogo vivem em day=0, que não é fase nenhuma. Sem mediaDay o pick() procura
// no dia da fase, não acha nada e a peça é silenciosamente pulada.
Deno.test("peça que usa slot do catálogo declara mediaDay 0", () => {
  const CATALOGO = [
    "logistica_img",
    "cep_img",
    "plantio_img",
    "producao_img",
    "capa",
    "recuperacao_img",
    "preco",
    "preco_2kg",
    "preco_4kg",
    "preco_10kg",
    "preco_20kg",
    "isca_silagem_capa",
  ];
  FASES.forEach((fase, i) => {
    for (const p of fase()) {
      const slot = p.kind === "media"
        ? (p as { slot: string }).slot
        : p.kind === "interactive"
        ? (p as { headerSlot?: string }).headerSlot
        : undefined;
      if (!slot || !CATALOGO.includes(slot)) continue;
      const dia = (p as { mediaDay?: number }).mediaDay;
      if (dia !== 0) {
        throw new Error(
          `fase ${i + 1}: slot "${slot}" é do catálogo mas mediaDay=${dia}`,
        );
      }
    }
  });
});
