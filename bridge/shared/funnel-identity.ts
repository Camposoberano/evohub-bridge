import { canalAlvoFunil } from "./funil-anuncio.ts";
import type { DbClient } from "./supabase.ts";

export const LEGACY_MAIN_FUNNEL = "mega-sorgo";
export const AD_5895_FUNNEL = "mega-sorgo-5895-v2";
export const RESTORED_5895_FUNNEL = "mega-sorgo-5895-20260930";
export const AD_5895_FUNNEL_LABEL = "Anúncios 5895 — 5 momentos";
export const LEGACY_MAIN_FUNNEL_LABEL = "Funil principal antigo (legado)";
export const RESTORED_5895_FUNNEL_LABEL =
  "Anúncios 5895 — funil completo 30/09";
export const MAIN_FUNNELS = [
  LEGACY_MAIN_FUNNEL,
  AD_5895_FUNNEL,
  RESTORED_5895_FUNNEL,
];

export function mainFunnelForChannel(
  channel: Record<string, unknown> | null | undefined,
): string {
  return channel && canalAlvoFunil(channel, "5895")
    ? RESTORED_5895_FUNNEL
    : LEGACY_MAIN_FUNNEL;
}

export function funnelLabel(funnel: unknown): string {
  const id = String(funnel ?? "");
  if (id === AD_5895_FUNNEL) return AD_5895_FUNNEL_LABEL;
  if (id === RESTORED_5895_FUNNEL) return RESTORED_5895_FUNNEL_LABEL;
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
    .select("name,external_id,phone_number")
    .eq("id", conversation.channel_id).maybeSingle();
  if (channelError) throw channelError;
  return mainFunnelForChannel(channel);
}
