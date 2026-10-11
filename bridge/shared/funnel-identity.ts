import { canalAlvoFunil } from "./funil-anuncio.ts";
import type { DbClient } from "./supabase.ts";
import { isApprovedSocialChannel } from "./social-channel-allowlist.ts";

export const LEGACY_MAIN_FUNNEL = "mega-sorgo";
export const AD_5895_FUNNEL = "mega-sorgo-5895-v2";
export const RESTORED_5895_FUNNEL = "mega-sorgo-5895-20260930";
export const SOCIAL_N8N_FUNNEL = "mega-sorgo-social-20260930";
export const AD_5895_FUNNEL_LABEL = "Anúncios 5895 — 5 momentos";
export const LEGACY_MAIN_FUNNEL_LABEL = "Funil principal antigo (legado)";
export const RESTORED_5895_FUNNEL_LABEL =
  "Anúncios 5895 — funil completo 30/09";
export const SOCIAL_N8N_FUNNEL_LABEL =
  "Anúncios sociais — funil completo 30/09";
export const MAIN_FUNNELS = [
  LEGACY_MAIN_FUNNEL,
  AD_5895_FUNNEL,
  RESTORED_5895_FUNNEL,
  SOCIAL_N8N_FUNNEL,
];

/** Rota n8n validada; outros canais seguem a identidade legada fora desta rota. */
export function funnelVersionForChannel(
  channel: Record<string, unknown> | null | undefined,
  enabledSocialIds?: ReadonlySet<string>,
): string | null {
  if (!channel) return null;
  if (canalAlvoFunil(channel, "5895")) return RESTORED_5895_FUNNEL;
  if (isApprovedSocialChannel(channel, enabledSocialIds)) return SOCIAL_N8N_FUNNEL;
  return null;
}

export function mainFunnelForChannel(
  channel: Record<string, unknown> | null | undefined,
): string {
  return funnelVersionForChannel(channel) ?? LEGACY_MAIN_FUNNEL;
}

export function funnelLabel(funnel: unknown): string {
  const id = String(funnel ?? "");
  if (id === AD_5895_FUNNEL) return AD_5895_FUNNEL_LABEL;
  if (id === RESTORED_5895_FUNNEL) return RESTORED_5895_FUNNEL_LABEL;
  if (id === SOCIAL_N8N_FUNNEL) return SOCIAL_N8N_FUNNEL_LABEL;
  if (id === LEGACY_MAIN_FUNNEL) return LEGACY_MAIN_FUNNEL_LABEL;
  return id;
}

export function isMainFunnel(funnel: unknown): boolean {
  return MAIN_FUNNELS.includes(String(funnel ?? ""));
}

export async function mainFunnelForConversation(
  db: DbClient,
  conversationId: string,
): Promise<string> {
  const { data: conversation, error: conversationError } = await db
    .from("conversations").select("channel_id").eq("id", conversationId)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation?.channel_id) return LEGACY_MAIN_FUNNEL;

  const { data: channel, error: channelError } = await db.from("channels")
    .select("id,type,name,external_id,phone_number")
    .eq("id", conversation.channel_id).maybeSingle();
  if (channelError) throw channelError;
  return mainFunnelForChannel(channel);
}
