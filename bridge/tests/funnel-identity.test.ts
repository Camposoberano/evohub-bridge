import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AD_5895_FUNNEL,
  AD_5895_FUNNEL_LABEL,
  funnelLabel,
  isMainFunnel,
  LEGACY_MAIN_FUNNEL,
  LEGACY_MAIN_FUNNEL_LABEL,
  mainFunnelForChannel,
} from "../shared/funnel-identity.ts";

Deno.test("o canal 5895 usa um identificador próprio para os cinco momentos", () => {
  assertEquals(
    mainFunnelForChannel({ name: "WA Oficial 5895" }),
    AD_5895_FUNNEL,
  );
  assertEquals(
    mainFunnelForChannel({ phone_number: "+55 19 99971-5895" }),
    AD_5895_FUNNEL,
  );
  assertEquals(
    mainFunnelForChannel({ name: "Outro WhatsApp" }),
    LEGACY_MAIN_FUNNEL,
  );
  assertEquals(mainFunnelForChannel(null), LEGACY_MAIN_FUNNEL);
});

Deno.test("os identificadores antigo e novo aparecem com rótulos distintos", () => {
  assertEquals(funnelLabel(LEGACY_MAIN_FUNNEL), LEGACY_MAIN_FUNNEL_LABEL);
  assertEquals(funnelLabel(AD_5895_FUNNEL), AD_5895_FUNNEL_LABEL);
  assertEquals(isMainFunnel(LEGACY_MAIN_FUNNEL), true);
  assertEquals(isMainFunnel(AD_5895_FUNNEL), true);
  assertEquals(isMainFunnel("mega-sorgo-followup"), false);
});
