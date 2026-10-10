import { autoEnrollFunil } from "../handlers/funil-enroll.ts";
import { canalAlvoFunil } from "./funil-anuncio.ts";
import { RESTORED_5895_FUNNEL } from "./funnel-identity.ts";
import { isContactBlocked, isContactExcludedFromAutomation } from "./lead-block.ts";
import { admin } from "./supabase.ts";

type Json = Record<string, unknown>;

/** Repara inscrições perdidas por falha transitória no webhook ou no n8n. */
export async function reconcileNewAdFunnels(
  now = Date.now(),
): Promise<{ scanned: number; missing: number; attempted: number }> {
  const db = admin();
  const { data: channels, error: channelError } = await db.from("channels")
    .select("id,name,external_id,phone_number").limit(200);
  if (channelError) throw channelError;
  const channel = ((channels ?? []) as Json[]).find((item) =>
    canalAlvoFunil(item, "5895")
  );
  if (!channel) return { scanned: 0, missing: 0, attempted: 0 };
  const since = new Date(now - 24 * 60 * 60_000).toISOString();
  const { data: conversations, error: conversationError } = await db.from(
    "conversations",
  ).select(
    "id,contact_id,chatwoot_conversation_id,opened_at,origem,bot_muted_at",
  ).eq("channel_id", channel.id).eq("origem", "anuncio")
    .eq("status", "open").eq("outcome", "open")
    .is("bot_muted_at", null).gte("opened_at", since)
    .order("opened_at", { ascending: false }).limit(200);
  if (conversationError) throw conversationError;
  const candidates = ((conversations ?? []) as Json[]).filter((item) =>
    Number(item.chatwoot_conversation_id) > 0
  );
  if (!candidates.length) return { scanned: 0, missing: 0, attempted: 0 };
  const ids = candidates.map((item) => String(item.id));
  const [sequenceResult, contactResult] = await Promise.all([
    db.from("sales_sequences").select("conversation_id")
      .in("conversation_id", ids).eq("funnel", RESTORED_5895_FUNNEL)
      .limit(200),
    db.from("contacts").select("id,external_contact_id,attributes")
      .in("id", candidates.map((item) => String(item.contact_id)))
      .limit(200),
  ]);
  if (sequenceResult.error) throw sequenceResult.error;
  if (contactResult.error) throw contactResult.error;
  const enrolled = new Set(
    ((sequenceResult.data ?? []) as Json[]).map((item) =>
      String(item.conversation_id)
    ),
  );
  const contacts = new Map(
    ((contactResult.data ?? []) as Json[]).map((item) => [String(item.id), item]),
  );
  let missing = 0;
  let attempted = 0;
  const seenContacts = new Set<string>();
  for (const conversation of candidates) {
    const contactId = String(conversation.contact_id);
    if (seenContacts.has(contactId)) continue;
    seenContacts.add(contactId);
    if (enrolled.has(String(conversation.id))) continue;
    const contact = contacts.get(contactId);
    if (!contact?.external_contact_id || isContactBlocked(contact) ||
      isContactExcludedFromAutomation(contact)) continue;
    missing++;
    try {
      attempted++;
      await autoEnrollFunil(
        db,
        channel,
        String(contact.external_contact_id),
        "",
        true,
        { sourceMessageId: `ad-watchdog:${conversation.id}` },
      );
    } catch (error) {
      console.error(
        "ad-funnel-watchdog: inscrição falhou",
        String(conversation.id),
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return { scanned: candidates.length, missing, attempted };
}
