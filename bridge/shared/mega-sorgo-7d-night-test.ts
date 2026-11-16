import { sevenDayTestConversationAllowed } from "./mega-sorgo-7d-gate.ts";

// Exceção única solicitada pelo dono para o ensaio no próprio número em 09/11.
const START = Date.parse("2026-11-09T04:40:00Z");
const END = Date.parse("2026-11-09T10:00:00Z");
const TEST_CONVERSATIONS = new Set([5004, 5005]);

export function isSevenDayNightTestWindow(now = Date.now()): boolean {
  return now >= START && now < END;
}

export function isSevenDayNightTest(chatwootConversationId: number, now = Date.now()): boolean {
  return isSevenDayNightTestWindow(now) && TEST_CONVERSATIONS.has(chatwootConversationId) &&
    sevenDayTestConversationAllowed(chatwootConversationId);
}
