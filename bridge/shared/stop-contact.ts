// stop-contact — encerra toda automação comercial de um contato de forma idempotente.
import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export async function stopContactAutomation(
  db: DbClient,
  channelId: string,
  externalContactId: string,
  reason: "explicit-reply" | "whatsapp-label",
): Promise<{ conversations: number; scheduled: number; campaigns: number }> {
  const phone = digits(externalContactId);
  const { data: contact } = await db.from("contacts").select("id,attributes")
    .eq("channel_id", channelId).eq("external_contact_id", externalContactId)
    .maybeSingle();
  if (!contact) return { conversations: 0, scheduled: 0, campaigns: 0 };

  const attrs = (contact.attributes ?? {}) as Json;
  await db.from("contacts").update({
    attributes: {
      ...attrs,
      blocked: true,
      blocked_reason: "nao-compra",
      blocked_at: new Date().toISOString(),
    },
  }).eq("id", contact.id);

  const { data: conversations } = await db.from("conversations")
    .select("id,outcome,outcome_source")
    .eq("contact_id", contact.id);
  const ids = ((conversations ?? []) as Json[]).map((row) => String(row.id));
  let scheduled = 0;
  for (const conversationId of ids) {
    const { count } = await db.from("scheduled_messages").update({
      status: "cancelled",
    }).eq("conversation_id", conversationId).in("status", ["pending", "paused"])
      .select("id", { count: "exact", head: true });
    scheduled += count ?? 0;
    await db.from("sales_sequences").update({ status: "cancelled" })
      .eq("conversation_id", conversationId).in("status", ["running", "paused"]);
    await db.from("conversations").update({
      outcome: "lost",
      outcome_source: reason,
      outcome_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", conversationId).neq("outcome", "won");
  }

  let campaigns = 0;
  if (phone) {
    const { count } = await db.from("campaign_queue").update({
      status: "skipped",
      last_error: "contato marcou não compra",
      updated_at: new Date().toISOString(),
    }).eq("contact_key", phone).in("status", ["pending", "paused", "processing"])
      .select("id", { count: "exact", head: true });
    campaigns = count ?? 0;
  }

  await db.from("events").insert({
    source: "funil",
    event_type: "contact_blocked_no_interest",
    channel_id: channelId,
    payload: {
      contact_id: contact.id,
      external_contact_id: phone.slice(-6),
      reason,
      conversations: ids.length,
      scheduled,
      campaigns,
    },
  });
  return { conversations: ids.length, scheduled, campaigns };
}
