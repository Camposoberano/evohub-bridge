/** IDs do Hub Soberano aprovados para a migração dos funis sociais ao n8n. */
export const APPROVED_SOCIAL_CHANNEL_IDS: ReadonlySet<string> = new Set([
  "2e49dea3-9d93-4f5f-ad54-02882956d1ed", // Facebook campo soberano
  "319d3aa4-26df-42bf-acbf-df440ef5981d", // Facebook Mega Sorgo Santa Elisa
  "93a082b0-e169-4cf8-9b1f-6e93758bf908", // Instagram Atendimento IG
  "1f056c55-fd58-4d55-943f-7d18c0dbc43b", // Instagram sorgo brasileiro
]);

/** A variável ativa um subconjunto para liberar um canal por vez. */
export function configuredSocialChannelIds(
  raw = Deno.env.get("SOBERANO_SOCIAL_CHANNEL_IDS") ?? "",
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

export function isApprovedSocialChannel(
  channel: Record<string, unknown> | null | undefined,
  enabledIds: ReadonlySet<string> = configuredSocialChannelIds(),
): boolean {
  if (!channel || !["facebook", "instagram"].includes(String(channel.type ?? ""))) return false;
  const id = String(channel.id ?? "");
  return APPROVED_SOCIAL_CHANNEL_IDS.has(id) && enabledIds.has(id);
}
