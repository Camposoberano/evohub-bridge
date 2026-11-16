import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  sevenDayConversationAllowed,
  sevenDayLiveMode,
  sevenDayTestConversationAllowed,
} from "../shared/mega-sorgo-7d-gate.ts";
import { validateEnqueueBody } from "../handlers/n8n-action-enqueue.ts";

Deno.test("portão: modo ao vivo libera qualquer conversa; fora dele, só a allowlist", () => {
  Deno.env.delete("MEGA_SORGO_7D_LIVE");
  assertEquals(sevenDayLiveMode(), false);
  // sem live: fiel ao fail-closed por allowlist
  assertEquals(sevenDayConversationAllowed(9999, "5004,5005"), false);
  assertEquals(sevenDayConversationAllowed(5004, "5004,5005"), true);
  assertEquals(sevenDayTestConversationAllowed(9999, "5004,5005"), false);

  Deno.env.set("MEGA_SORGO_7D_LIVE", "true");
  try {
    assertEquals(sevenDayLiveMode(), true);
    // ao vivo: qualquer conversa real passa, independente da allowlist
    assertEquals(sevenDayConversationAllowed(9999, "5004,5005"), true);
    // id inválido nunca passa, mesmo ao vivo
    assertEquals(sevenDayConversationAllowed(0, ""), false);
    assertEquals(sevenDayConversationAllowed(-1, ""), false);
  } finally {
    Deno.env.delete("MEGA_SORGO_7D_LIVE");
  }
});

Deno.test("enqueue do 7d: anúncio só é aceito no modo ao vivo; macro sempre", () => {
  const seven = {
    request_id: "golive-test",
    source: "ad" as const,
    chatwoot_conversation_id: 5114,
    action: "funil" as const,
    funnel_version: "mega-sorgo-7d-v1",
  };
  Deno.env.delete("MEGA_SORGO_7D_LIVE");
  // fora do rollout, lead de anúncio no 7d é recusado (preserva o ensaio por macro)
  assertEquals(validateEnqueueBody({ request: seven, pieces: [] }).ok, false);
  assertEquals(
    validateEnqueueBody({ request: { ...seven, source: "macro" }, pieces: [] }).ok,
    true,
  );

  Deno.env.set("MEGA_SORGO_7D_LIVE", "true");
  try {
    assertEquals(validateEnqueueBody({ request: seven, pieces: [] }).ok, true);
    assertEquals(
      validateEnqueueBody({ request: { ...seven, source: "macro" }, pieces: [] }).ok,
      true,
    );
  } finally {
    Deno.env.delete("MEGA_SORGO_7D_LIVE");
  }
});
