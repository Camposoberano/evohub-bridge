// Consumidor de contingencia da fila do funil.
// O claim em deliveries evita duplicacao se o n8n e este loop enxergarem a mesma linha.
import { admin, claimDelivery } from "./supabase.ts";
import { env } from "./env.ts";
import { handle as sendOutbound } from "../handlers/send-outbound.ts";

type Json = Record<string, unknown>;

let running = false;
const BRT_OFFSET_MINUTES = 180;

export function businessShiftMinutes(values: string[]): number {
  const minutes = values.map((value) => {
    const date = new Date(value);
    const brt = new Date(date.getTime() - BRT_OFFSET_MINUTES * 60_000);
    return brt.getUTCHours() * 60 + brt.getUTCMinutes();
  });
  if (!minutes.length) return 0;
  const min = Math.min(...minutes);
  const max = Math.max(...minutes);
  if (min < 6 * 60) return 6 * 60 - min;
  if (max >= 22 * 60) return 24 * 60 - min + 6 * 60;
  return 0;
}

async function normalizeBusinessQueue(db: ReturnType<typeof admin>): Promise<number> {
  const { data, error } = await db.from("scheduled_messages")
    .select("id,conversation_id,day,send_at,status")
    .in("status", ["pending", "paused"]).order("send_at", { ascending: true })
    .limit(2000);
  if (error) throw error;
  const groups = new Map<string, Json[]>();
  for (const row of (data ?? []) as Json[]) {
    const key = `${row.conversation_id}:${row.day}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let shifted = 0;
  for (const rows of groups.values()) {
    const delta = businessShiftMinutes(rows.map((row) => String(row.send_at)));
    if (!delta) continue;
    for (const row of rows) {
      const sendAt = new Date(new Date(String(row.send_at)).getTime() + delta * 60_000).toISOString();
      await db.from("scheduled_messages").update({ send_at: sendAt }).eq("id", row.id);
      shifted++;
    }
  }
  return shifted;
}

export async function pumpFunnelQueue(limit = 10): Promise<{ found: number; sent: number; failed: number }> {
  if (running) return { found: 0, sent: 0, failed: 0 };
  running = true;
  try {
    const db = admin();
    await normalizeBusinessQueue(db);
    const now = new Date().toISOString();
    const { data, error } = await db.from("scheduled_messages")
      .select("id,conversation_id,chatwoot_conversation_id,funnel,day,type,payload,send_at")
      .eq("status", "pending")
      .lte("send_at", now)
      .order("send_at", { ascending: true })
      .limit(limit);
    if (error) throw error;

    let sent = 0;
    let failed = 0;
    for (const row of (data ?? []) as Json[]) {
      const id = String(row.id ?? "");
      if (!id) continue;
      const claimKey = `funnel-queue-${id}`;
      if (!await claimDelivery(db, claimKey, "funnel-queue")) continue;

      const payload = (row.payload && typeof row.payload === "object") ? row.payload as Json : {};
      const res = await sendOutbound(new Request(`http://internal/send-outbound?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatwoot_conversation_id: Number(row.chatwoot_conversation_id),
          type: String(row.type ?? "text"),
          payload,
        }),
      }));
      const body = await res.json().catch(() => ({} as Json));
      if (res.ok && body.ok !== false && !body.blocked) {
        const sentAt = new Date().toISOString();
        await db.from("scheduled_messages").update({ status: "sent", sent_at: sentAt }).eq("id", id);
        await db.from("sales_sequences").update({
          current_day: Number(row.day ?? 0),
          last_sent_at: sentAt,
        }).eq("conversation_id", row.conversation_id)
          .eq("funnel", row.funnel ?? "mega-sorgo")
          .in("status", ["running", "paused"]);
        sent++;
      } else {
        await db.from("scheduled_messages").update({ status: "failed" }).eq("id", id);
        await db.from("deliveries").delete().eq("delivery_id", claimKey);
        failed++;
      }
    }
    return { found: data?.length ?? 0, sent, failed };
  } finally {
    running = false;
  }
}
