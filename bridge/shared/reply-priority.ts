// reply-priority — escala a Prioridade NATIVA do Chatwoot conforme o tempo sem resposta humana.
// Portado do hub CECAPE (reply-priority-lgt.ts), generalizado: roda em qualquer canal WhatsApp
// ativo (sem gate de inbox LGT). Precisa da migration 0029 (colunas + trigger) e é gated no server.
import type { DbClient } from "./supabase.ts";
import { accountForChannel } from "./accounts.ts";
import { type NativePriority, setConversationPriority } from "./chatwoot.ts";

export function priorityLevel(
  lastCustomerAt: string | null | undefined,
  lastHumanAt: string | null | undefined,
  now = Date.now(),
): 0 | 1 | 2 | 3 | 4 {
  const customer = Date.parse(lastCustomerAt ?? "");
  const human = Date.parse(lastHumanAt ?? "");
  if (!Number.isFinite(customer) || (Number.isFinite(human) && human >= customer)) return 0;
  const elapsed = Math.max(0, now - customer);
  if (elapsed >= 20 * 60_000) return 4;
  if (elapsed >= 15 * 60_000) return 3;
  if (elapsed >= 10 * 60_000) return 2;
  if (elapsed >= 5 * 60_000) return 1;
  return 0;
}

export function nativePriority(level: number): NativePriority {
  return ([null, "low", "medium", "high", "urgent"] as const)[level] ?? null;
}

/** Marca o horário da resposta humana numa conversa (zera a escalada). Chamado no webhook. */
export async function markHumanReply(db: DbClient, channelId: string, cwId: number): Promise<void> {
  const { error } = await db.from("conversations")
    .update({ last_human_reply_at: new Date().toISOString() })
    .eq("channel_id", channelId).eq("chatwoot_conversation_id", cwId);
  if (error) throw error;
}

/** Variante pelo id local da conversa — usada no webhook, que já resolveu a conversa. */
export async function markHumanReplyByConversation(db: DbClient, conversationId: string): Promise<void> {
  const { error } = await db.from("conversations")
    .update({ last_human_reply_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) throw error;
}

type Row = {
  id: string;
  channel_id: string;
  chatwoot_conversation_id: number | null;
  last_customer_message_at: string | null;
  last_human_reply_at: string | null;
  response_priority_level: number;
};

// A primeira execução pode encontrar muitas conversas antigas. Distribua as atualizações para
// não competir com a interface dos atendentes pela API.
const MAX_PRIORITY_WRITES_PER_TICK = 10;
let rateLimitedUntil = 0;

export async function reconcileResponsePriorities(
  db: DbClient,
  now = Date.now(),
): Promise<{ scanned: number; changed: number; failed: number }> {
  if (now < rateLimitedUntil) return { scanned: 0, changed: 0, failed: 0 };
  const { data: channels, error: channelsError } = await db.from("channels")
    .select("id").eq("type", "whatsapp").eq("status", "active");
  if (channelsError) throw channelsError;
  const channelIds = ((channels ?? []) as Array<Record<string, unknown>>).map((row) => String(row.id));
  if (!channelIds.length) return { scanned: 0, changed: 0, failed: 0 };

  const pageSize = 500;
  let scanned = 0, changed = 0, failed = 0, attempted = 0;
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await db.from("conversations")
      .select("id,channel_id,chatwoot_conversation_id,last_customer_message_at,last_human_reply_at,response_priority_level")
      .in("channel_id", channelIds)
      .neq("status", "resolved")
      .not("last_customer_message_at", "is", null)
      .order("last_customer_message_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Row[];
    scanned += rows.length;
    for (const row of rows) {
      if (attempted >= MAX_PRIORITY_WRITES_PER_TICK) return { scanned, changed, failed };
      if (!row.chatwoot_conversation_id) continue;
      const level = priorityLevel(row.last_customer_message_at, row.last_human_reply_at, now);
      if (level === row.response_priority_level) continue;
      attempted++;
      try {
        const { data: latest, error: latestError } = await db.from("conversations")
          .select("last_customer_message_at,last_human_reply_at")
          .eq("id", row.id).maybeSingle();
        if (latestError) throw latestError;
        if (!latest || latest.last_customer_message_at !== row.last_customer_message_at ||
          latest.last_human_reply_at !== row.last_human_reply_at) continue;
        await setConversationPriority(
          row.chatwoot_conversation_id,
          nativePriority(level),
          await accountForChannel(row.channel_id),
        );
        let update = db.from("conversations")
          .update({ response_priority_level: level })
          .eq("id", row.id).eq("last_customer_message_at", row.last_customer_message_at);
        update = row.last_human_reply_at
          ? update.eq("last_human_reply_at", row.last_human_reply_at)
          : update.is("last_human_reply_at", null);
        const { error: updateError } = await update;
        if (updateError) throw updateError;
        changed++;
      } catch (error) {
        failed++;
        console.warn("reply-priority: prioridade falhou", row.id, String(error).slice(0, 120));
        if (/Chatwoot setConversationPriority 429/.test(String(error))) {
          rateLimitedUntil = Date.now() + 2 * 60_000;
          return { scanned, changed, failed };
        }
      }
    }
    if (rows.length < pageSize) break;
  }
  return { scanned, changed, failed };
}
