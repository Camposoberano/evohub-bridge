import { optionalEnv } from "./env.ts";
import { APPROVED_SOCIAL_CHANNEL_IDS } from "./social-channel-allowlist.ts";
import { MEGA_SORGO_7D_VERSION } from "./mega-sorgo-7d-content.ts";

export function isSevenDayWhatsAppChannel(channel: Record<string, unknown> | null): boolean {
  if (!channel || channel.type !== "whatsapp") return false;
  const name = String(channel.name ?? "");
  const phone = String(channel.phone_number ?? "").replace(/\D/g, "");
  return ["5895", "6836"].includes(name) && phone.endsWith(name);
}

/**
 * Subconjunto de APPROVED_SOCIAL_CHANNEL_IDS liberado para a cobertura do funil 7d em
 * canal social (Instagram/Facebook). Allowlist PRÓPRIA do 7d — NÃO reusa a
 * `SOBERANO_SOCIAL_CHANNEL_IDS`, que liga o funil social antigo do n8n.
 *
 * Off by default (fail closed): sem a env `MEGA_SORGO_7D_SOCIAL_CHANNEL_IDS`, retorna vazio
 * = desligado. Qualquer lista inválida (id fora dos aprovados, duplicado, ou maior que o
 * conjunto aprovado) também retorna vazio. Mesmo padrão de `configuredSocialChannelIds`.
 */
export function sevenDaySocialChannelIds(
  raw = optionalEnv("MEGA_SORGO_7D_SOCIAL_CHANNEL_IDS") ?? "",
): ReadonlySet<string> {
  if (!raw.trim()) return new Set();
  const ids = raw.split(",").map((id) => id.trim());
  if (
    ids.length > APPROVED_SOCIAL_CHANNEL_IDS.size ||
    ids.some((id) => !APPROVED_SOCIAL_CHANNEL_IDS.has(id)) ||
    new Set(ids).size !== ids.length
  ) return new Set();
  return new Set(ids);
}

/**
 * Canal social (IG/FB) aprovado E habilitado na allowlist do 7d. Espelha
 * `isSevenDayWhatsAppChannel`: só é verdadeiro para um canal de tipo instagram/facebook
 * cujo id esteja em APPROVED_SOCIAL_CHANNEL_IDS e também na env do 7d.
 */
export function isSevenDaySocialChannel(
  channel: Record<string, unknown> | null | undefined,
  enabledIds: ReadonlySet<string> = sevenDaySocialChannelIds(),
): boolean {
  if (!channel || !["instagram", "facebook"].includes(String(channel.type ?? ""))) return false;
  const id = String(channel.id ?? "");
  return APPROVED_SOCIAL_CHANNEL_IDS.has(id) && enabledIds.has(id);
}

/**
 * Áudio do 7d num canal social (Instagram/Facebook) é PULADO — decisão do dono: IG não faz
 * nota de voz. Vale só para o 7d (`MEGA_SORGO_7D_VERSION`); o funil social n8n antigo mantém
 * a própria conversão de áudio. Pura, para o send-outbound decidir sem reler a regra.
 */
export function shouldSkipSevenDaySocialAudio(
  channelType: unknown,
  funnel: unknown,
  pieceType: unknown,
): boolean {
  return pieceType === "audio" &&
    ["instagram", "facebook"].includes(String(channelType ?? "")) &&
    String(funnel ?? "").startsWith(MEGA_SORGO_7D_VERSION);
}

/** Fail closed until an operator lists exact Chatwoot test conversation IDs. */
export function sevenDayTestConversationAllowed(
  chatwootConversationId: number,
  allowlist = optionalEnv("MEGA_SORGO_7D_TEST_CONVERSATIONS") ?? "",
): boolean {
  if (!Number.isSafeInteger(chatwootConversationId) || chatwootConversationId <= 0) return false;
  return allowlist.split(",").some((raw) => raw.trim() === String(chatwootConversationId));
}

/**
 * Rollout geral: com MEGA_SORGO_7D_LIVE=true o funil de 7 dias deixa de ser ensaio por
 * allowlist e passa a valer para qualquer lead novo dos canais 5895/6836. Sem a flag,
 * o comportamento "fail closed" por conversa de teste é mantido.
 */
export function sevenDayLiveMode(): boolean {
  return (optionalEnv("MEGA_SORGO_7D_LIVE") ?? "") === "true";
}

/** Conversa autorizada a receber o 7d: ao vivo libera qualquer conversa real; senão só a allowlist. */
export function sevenDayConversationAllowed(
  chatwootConversationId: number,
  allowlist = optionalEnv("MEGA_SORGO_7D_TEST_CONVERSATIONS") ?? "",
): boolean {
  if (!Number.isSafeInteger(chatwootConversationId) || chatwootConversationId <= 0) return false;
  if (sevenDayLiveMode()) return true;
  return sevenDayTestConversationAllowed(chatwootConversationId, allowlist);
}
