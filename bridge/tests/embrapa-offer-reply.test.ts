import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveEmbrapaOfferReply } from "../shared/embrapa-offer-reply.ts";

const campaignId = "isca-embrapa-sul-sudeste-5895-2026-09-25";
const offer = (replyId: string | null, text: string | null) =>
  resolveEmbrapaOfferReply({ campaignId, stepId: "oferta", replyId, text });

Deno.test("Embrapa: clique do botão mantém o ramo escolhido", () => {
  assertEquals(offer("quero", "Quero o material 📩"), "quero");
  assertEquals(offer("nao", "Agora não"), "nao");
});

Deno.test("Embrapa: texto afirmativo explícito libera o material", () => {
  for (
    const text of [
      "Quero",
      "Quero o material",
      "Quero o PDF",
      "Sim, quero",
      "Pode enviar o PDF",
      "Me manda o material",
    ]
  ) {
    assertEquals(offer(null, text), "quero", text);
  }
});

Deno.test("Embrapa: recusa explícita segue o ramo de recusa", () => {
  for (const text of ["Não", "Agora não", "Não obrigado", "Não quero o PDF"]) {
    assertEquals(offer(null, text), "nao", text);
  }
});

Deno.test("Embrapa: dúvida e texto ambíguo não decidem o fluxo", () => {
  for (
    const text of [
      "Quanto custa?",
      "Não sei se quero",
      "Talvez",
      "Quero saber o preço",
      "",
      null,
    ]
  ) {
    assertEquals(offer(null, text), null, String(text));
  }
});

Deno.test("Embrapa: outros fluxos e passos seguem suas próprias regras", () => {
  assertEquals(
    resolveEmbrapaOfferReply({
      campaignId: "outro",
      stepId: "oferta",
      replyId: null,
      text: "Quero",
    }),
    undefined,
  );
  assertEquals(
    resolveEmbrapaOfferReply({
      campaignId,
      stepId: "quero",
      replyId: null,
      text: "Quero",
    }),
    undefined,
  );
});
