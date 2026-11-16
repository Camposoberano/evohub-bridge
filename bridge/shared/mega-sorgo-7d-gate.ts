import { optionalEnv } from "./env.ts";

export function isSevenDayWhatsAppChannel(channel: Record<string, unknown> | null): boolean {
  if (!channel || channel.type !== "whatsapp") return false;
  const name = String(channel.name ?? "");
  const phone = String(channel.phone_number ?? "").replace(/\D/g, "");
  return ["5895", "6836"].includes(name) && phone.endsWith(name);
}

/** Fail closed until an operator lists exact Chatwoot test conversation IDs. */
export function sevenDayTestConversationAllowed(
  chatwootConversationId: number,
  allowlist = optionalEnv("MEGA_SORGO_7D_TEST_CONVERSATIONS") ?? "",
): boolean {
  if (!Number.isSafeInteger(chatwootConversationId) || chatwootConversationId <= 0) return false;
  return allowlist.split(",").some((raw) => raw.trim() === String(chatwootConversationId));
}
