// Consumidor de contingencia da fila do funil.
// O claim em deliveries evita duplicacao se o n8n e este loop enxergarem a mesma linha.
import { admin, claimDelivery } from "./supabase.ts";
import { env } from "./env.ts";
import { handle as sendOutbound } from "../handlers/send-outbound.ts";

type Json = Record<string, unknown>;

let running = false;

export async function pumpFunnelQueue(limit = 10): Promise<{ found: number; sent: number; failed: number }> {
  if (running) return { found: 0, sent: 0, failed: 0 };
  running = true;
  try {
    const db = admin();
    const now = new Date().toISOString();
    const { data, error } = await db.from("scheduled_messages")
      .select("id,chatwoot_conversation_id,type,payload,send_at")
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
        await db.from("scheduled_messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id);
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
