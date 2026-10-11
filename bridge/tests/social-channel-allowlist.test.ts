import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVED_SOCIAL_CHANNEL_IDS,
  configuredSocialChannelIds,
  isApprovedSocialChannel,
} from "../shared/social-channel-allowlist.ts";

const FACEBOOK_CAMPO = "2e49dea3-9d93-4f5f-ad54-02882956d1ed";
const INSTAGRAM_ATENDIMENTO = "93a082b0-e169-4cf8-9b1f-6e93758bf908";
const INSTAGRAM_DAVID = "66c6120b-4f92-4e5b-9d00-312c6f43456d";

Deno.test("a lista fixa contém quatro canais comerciais e exclui david inst", () => {
  assertEquals(APPROVED_SOCIAL_CHANNEL_IDS.size, 4);
  assertEquals(APPROVED_SOCIAL_CHANNEL_IDS.has(FACEBOOK_CAMPO), true);
  assertEquals(APPROVED_SOCIAL_CHANNEL_IDS.has(INSTAGRAM_ATENDIMENTO), true);
  assertEquals(APPROVED_SOCIAL_CHANNEL_IDS.has(INSTAGRAM_DAVID), false);
});

Deno.test("a configuração aceita subconjunto para implantação gradual e falha fechada", () => {
  assertEquals(configuredSocialChannelIds(FACEBOOK_CAMPO).size, 1);
  assertEquals(configuredSocialChannelIds(`${FACEBOOK_CAMPO},${INSTAGRAM_ATENDIMENTO}`).size, 2);
  assertEquals(configuredSocialChannelIds("").size, 0);
  assertEquals(configuredSocialChannelIds(`${FACEBOOK_CAMPO},${FACEBOOK_CAMPO}`).size, 0);
  assertEquals(configuredSocialChannelIds(`${FACEBOOK_CAMPO},${INSTAGRAM_DAVID}`).size, 0);
});

Deno.test("o canal social exige ID habilitado e tipo correto, sem confiar no nome", () => {
  const enabled = new Set([FACEBOOK_CAMPO, INSTAGRAM_ATENDIMENTO]);
  assertEquals(isApprovedSocialChannel({ id: FACEBOOK_CAMPO, type: "facebook" }, enabled), true);
  assertEquals(isApprovedSocialChannel({ id: INSTAGRAM_ATENDIMENTO, type: "instagram" }, enabled), true);
  assertEquals(isApprovedSocialChannel({ id: INSTAGRAM_DAVID, type: "instagram" }, enabled), false);
  assertEquals(isApprovedSocialChannel({ id: "other", name: "campo soberano", type: "facebook" }, enabled), false);
  assertEquals(isApprovedSocialChannel({ id: INSTAGRAM_ATENDIMENTO, type: "whatsapp" }, enabled), false);
});
