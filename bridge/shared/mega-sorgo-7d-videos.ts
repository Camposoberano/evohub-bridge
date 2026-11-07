import type { DbClient } from "./supabase.ts";
import { actionUuid } from "./n8n-action-contract.ts";
import { MEGA_SORGO_7D_VERSION, SEVEN_DAY_CONDITIONAL_VIDEOS } from "./mega-sorgo-7d-content.ts";
import { scheduleSevenDayPieces } from "./mega-sorgo-7d-schedule.ts";

/** Aceite explícito: enfileira uma única vez, na ordem, com mídia confirmada. */
export async function enqueueSevenDayVideos(
  db: DbClient,
  conversationId: string,
  chatwootConversationId: number,
  now = Date.now(),
): Promise<number> {
  const { data: sequence, error: sequenceError } = await db.from("sales_sequences")
    .select("id,status").eq("conversation_id", conversationId)
    .eq("funnel", MEGA_SORGO_7D_VERSION).maybeSingle();
  if (sequenceError) throw sequenceError;
  if (sequence?.status !== "running") return 0;
  const { data: media, error: mediaError } = await db.from("funnel_media")
    .select("slot,url,type").eq("funnel", MEGA_SORGO_7D_VERSION)
    .eq("day", 0).eq("active", true).limit(100);
  if (mediaError) throw mediaError;
  const bySlot = new Map<string, { slot: string; url: string; type: string }>(
    ((media ?? []) as { slot: string; url: string; type: string }[])
      .map((row) => [String(row.slot), row]),
  );
  const scheduled = scheduleSevenDayPieces(SEVEN_DAY_CONDITIONAL_VIDEOS.map((_, i) => ({
    code: `official_0${i + 1}`, day: 1,
  })), now);
  const rows = await Promise.all(SEVEN_DAY_CONDITIONAL_VIDEOS.map(async (video, step) => {
    const slot = video.payload.media_ref.slot;
    const found = bySlot.get(slot);
    if (!found?.url || found.type !== "video") throw new Error(`vídeo oficial ausente: ${slot}`);
    return {
      id: await actionUuid(`${MEGA_SORGO_7D_VERSION}:${conversationId}:${slot}`),
      conversation_id: conversationId,
      chatwoot_conversation_id: chatwootConversationId,
      funnel: `${MEGA_SORGO_7D_VERSION}:video`,
      day: 0,
      step,
      type: "video",
      payload: { media_url: found.url, __funnel_piece_code: slot },
      send_at: scheduled[step].sendAt,
      status: "pending",
    };
  }));
  const { data: existing, error: existingError } = await db.from("scheduled_messages")
    .select("id").in("id", rows.map((row) => row.id));
  if (existingError) throw existingError;
  if (existing?.length) return 0;
  const { error: insertError } = await db.from("scheduled_messages")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
  if (insertError) throw insertError;
  return rows.length;
}
