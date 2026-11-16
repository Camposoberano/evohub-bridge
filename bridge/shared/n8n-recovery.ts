import { getConversationLabels, setConversationLabels } from "./chatwoot.ts";
import { accountForChannel } from "./accounts.ts";
import { RESTORED_5895_FUNNEL, SOCIAL_N8N_FUNNEL } from "./funnel-identity.ts";
import { admin, claimDelivery, releaseDelivery } from "./supabase.ts";

type Db = ReturnType<typeof admin>;
type Json = Record<string, unknown>;

export function recoveryVariation(funnel: unknown): number | null {
  const match = String(funnel ?? "").match(
    new RegExp(`^(?:${RESTORED_5895_FUNNEL}|${SOCIAL_N8N_FUNNEL}):recuperacao-([1-4])$`),
  );
  return match ? Number(match[1]) : null;
}

export function allRecoveryPiecesSent(pieces: Array<{ status: string }>): boolean {
  return pieces.length > 0 && pieces.every((piece) => piece.status === "sent");
}

/** Only a fully confirmed recovery advances the automatic recovery chain. */
export async function confirmN8nRecovery(
  db: Db,
  row: Json,
  channelId: string,
): Promise<boolean> {
  const variation = recoveryVariation(row.funnel);
  if (!variation) return false;
  const conversationId = String(row.conversation_id ?? "");
  const cwConvId = Number(row.chatwoot_conversation_id ?? 0);
  if (!conversationId || !cwConvId || !channelId) return false;

  const { data: pieces, error: piecesError } = await db.from("scheduled_messages")
    .select("status").eq("conversation_id", conversationId)
    .eq("funnel", row.funnel);
  if (piecesError) throw piecesError;
  if (!allRecoveryPiecesSent((pieces ?? []) as Array<{ status: string }>)) {
    return false;
  }

  const claimKey = `recovery-${conversationId}-${variation}`;
  if (!await claimDelivery(db, claimKey, "recovery")) return true;
  const { error: eventError } = await db.from("events").insert({
    source: "recovery",
    event_type: "recovery_sent",
    payload: {
      conversation_id: conversationId,
      chatwoot_conversation_id: cwConvId,
      variation,
      channel: "WhatsApp",
      via: "n8n",
      pieces: pieces.length,
    },
  });
  if (eventError) {
    await releaseDelivery(db, claimKey);
    throw eventError;
  }
  try {
    const acct = await accountForChannel(channelId);
    const labels = await getConversationLabels(cwConvId, acct);
    await setConversationLabels(cwConvId, [
      ...new Set([
        ...labels.filter((label) => label !== "recuperacao-respondeu"),
        `recuperacao-${variation}-enviada`,
        "recuperacao-aguardando",
      ]),
    ], acct);
  } catch (error) {
    console.warn("n8n-recovery: etiquetas não atualizadas:", error);
  }
  return true;
}
