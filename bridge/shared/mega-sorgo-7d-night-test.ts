import { sevenDayTestConversationAllowed } from "./mega-sorgo-7d-gate.ts";

// Exceção de uma única madrugada, solicitada pelo dono para o ensaio nos seus dois chats.
// O limite absoluto evita que uma rotina de teste permaneça aberta para leads reais.
const START = Date.parse("2026-11-08T03:00:00Z");
const END = Date.parse("2026-11-08T08:00:00Z");
const TEST_CONVERSATIONS = new Set([673, 1286]);

export function isSevenDayNightTest(
  chatwootConversationId: number,
  now = Date.now(),
): boolean {
  return now >= START && now < END &&
    TEST_CONVERSATIONS.has(chatwootConversationId) &&
    sevenDayTestConversationAllowed(chatwootConversationId);
}

export function isSevenDayNightTestWindow(now = Date.now()): boolean {
  return now >= START && now < END;
}
