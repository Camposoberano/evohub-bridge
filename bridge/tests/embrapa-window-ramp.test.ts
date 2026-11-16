import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { capDoDia, intervaloMs } from "../shared/campaign-pace.ts";
import {
  EMBRAPA_5895_CAMPAIGN_ID,
  shouldDeferEmbrapaPdf,
} from "../shared/embrapa-offer-reply.ts";

const pace = {
  capInicial: 50,
  capIncremento: 5,
  capMaximo: 1251,
  horaInicio: 8,
  horaFim: 20,
};
const restart = Date.parse("2026-10-14T11:00:00Z");

Deno.test("rampa reiniciada em 14/10: 50, 55 e 60 ofertas", () => {
  assertEquals(capDoDia(pace, restart, restart - 1), 0);
  assertEquals(capDoDia(pace, restart, restart), 50);
  assertEquals(capDoDia(pace, restart, restart + 24 * 3600_000), 55);
  assertEquals(capDoDia(pace, restart, restart + 48 * 3600_000), 60);
  assertEquals(intervaloMs(pace, 50), 14.4 * 60_000);
});

Deno.test("PDF solicitado fora de 08h–20h é adiado; demais ramos não são", () => {
  const base = {
    campaignId: EMBRAPA_5895_CAMPAIGN_ID,
    stepId: "oferta",
    branchReplyId: "quero",
    pace,
  };
  assertEquals(shouldDeferEmbrapaPdf({ ...base, now: restart - 1 }), true);
  assertEquals(shouldDeferEmbrapaPdf({ ...base, now: restart }), false);
  assertEquals(shouldDeferEmbrapaPdf({ ...base, now: Date.parse("2026-10-14T22:59:59Z") }), false);
  assertEquals(shouldDeferEmbrapaPdf({ ...base, now: Date.parse("2026-10-14T23:00:00Z") }), true);
  assertEquals(shouldDeferEmbrapaPdf({ ...base, branchReplyId: "nao", now: restart - 1 }), false);
  assertEquals(shouldDeferEmbrapaPdf({ ...base, campaignId: "outro", now: restart - 1 }), false);
});
