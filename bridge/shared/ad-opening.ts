import { handle as sendOutbound } from "../handlers/send-outbound.ts";
import { env } from "./env.ts";
import { RESTORED_5895_FUNNEL } from "./funnel-identity.ts";
import { admin } from "./supabase.ts";

/** Envia a primeira peça após a inscrição, sem esperar o cron da fila. */
export async function sendFirstAdFunnelPieceNow(
  db: ReturnType<typeof admin>,
  conversationId: string,
): Promise<boolean> {
  // O n8n pode concluir a criação logo depois da resposta HTTP. Esperar no máximo 1 s.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row, error } = await db.from("scheduled_messages")
      .select("id,chatwoot_conversation_id,funnel,day,step,type,payload,send_at")
      .eq("conversation_id", conversationId)
      .eq("funnel", RESTORED_5895_FUNNEL)
      .eq("step", 0).eq("status", "pending").maybeSingle();
    if (error) throw error;
    if (row) {
      if (Date.parse(String(row.send_at)) > Date.now()) return false;
      const response = await sendOutbound(new Request(
        `http://internal/send-outbound?token=${encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatwoot_conversation_id: Number(row.chatwoot_conversation_id),
            type: row.type,
            payload: row.payload,
            funnel: row.funnel,
            funnel_day: row.day,
            funnel_step: row.type,
            scheduled_message_id: row.id,
          }),
        },
      ));
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok && result.sent === true) return true;
      if (result.in_progress === true || result.already_sent === true) return true;
      console.warn("ad-opening: envio imediato não confirmado", conversationId,
        response.status, String(result.blocked ?? result.error ?? "unknown"));
      return false;
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
