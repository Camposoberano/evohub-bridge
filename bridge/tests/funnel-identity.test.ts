import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AD_5895_FUNNEL,
  AD_5895_FUNNEL_LABEL,
  RESTORED_5895_FUNNEL,
  RESTORED_5895_FUNNEL_LABEL,
  funnelLabel,
  isMainFunnel,
  LEGACY_MAIN_FUNNEL,
  LEGACY_MAIN_FUNNEL_LABEL,
  mainFunnelForChannel,
  funnelVersionForChannel,
  SOCIAL_N8N_FUNNEL,
  SOCIAL_N8N_FUNNEL_LABEL,
} from "../shared/funnel-identity.ts";

Deno.test("o canal 5895 usa um identificador próprio para a versão de 30/09", () => {
  assertEquals(
    mainFunnelForChannel({ name: "WA Oficial 5895" }),
    RESTORED_5895_FUNNEL,
  );
  assertEquals(
    mainFunnelForChannel({ phone_number: "+55 19 99971-5895" }),
    RESTORED_5895_FUNNEL,
  );
  assertEquals(
    mainFunnelForChannel({ name: "Outro WhatsApp" }),
    LEGACY_MAIN_FUNNEL,
  );
  assertEquals(mainFunnelForChannel(null), LEGACY_MAIN_FUNNEL);
});

Deno.test("o funil social tem identidade própria somente em canal habilitado", () => {
  const enabled = new Set(["2e49dea3-9d93-4f5f-ad54-02882956d1ed"]);
  assertEquals(
    funnelVersionForChannel({ id: "2e49dea3-9d93-4f5f-ad54-02882956d1ed", type: "facebook" }, enabled),
    SOCIAL_N8N_FUNNEL,
  );
  assertEquals(
    funnelVersionForChannel({ id: "66c6120b-4f92-4e5b-9d00-312c6f43456d", type: "instagram" }, enabled),
    null,
  );
  assertEquals(funnelVersionForChannel({ name: "WA Oficial 5895" }, enabled), RESTORED_5895_FUNNEL);
  assertEquals(funnelLabel(SOCIAL_N8N_FUNNEL), SOCIAL_N8N_FUNNEL_LABEL);
  assertEquals(isMainFunnel(SOCIAL_N8N_FUNNEL), true);
});

Deno.test("os identificadores antigo e novo aparecem com rótulos distintos", () => {
  assertEquals(funnelLabel(LEGACY_MAIN_FUNNEL), LEGACY_MAIN_FUNNEL_LABEL);
  assertEquals(funnelLabel(AD_5895_FUNNEL), AD_5895_FUNNEL_LABEL);
  assertEquals(funnelLabel(RESTORED_5895_FUNNEL), RESTORED_5895_FUNNEL_LABEL);
  assertEquals(isMainFunnel(LEGACY_MAIN_FUNNEL), true);
  assertEquals(isMainFunnel(AD_5895_FUNNEL), true);
  assertEquals(isMainFunnel(RESTORED_5895_FUNNEL), true);
  assertEquals(isMainFunnel("mega-sorgo-followup"), false);
});
