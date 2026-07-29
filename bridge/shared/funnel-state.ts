import { admin } from "./supabase.ts";

// Pausa somente a sequencia Mega Sorgo ativa da conversa. O motivo fica
// registrado para auditoria e para uma retomada deliberada pelo atendente.
export async function autoPauseFunil(
  conversationId: string,
  reason = "intencao comercial",
): Promise<boolean> {
  const db = admin();
  const { data: seq } = await db.from("sales_sequences").select("id, status")
    .eq("conversation_id", conversationId).eq("status", "running")
    .maybeSingle();
  if (!seq) return false;

  await db.from("scheduled_messages").update({ status: "paused" })
    .eq("conversation_id", conversationId).eq("status", "pending");
  await db.from("sales_sequences").update({ status: "paused" }).eq(
    "id",
    seq.id,
  );
  await db.from("events").insert({
    source: "funil",
    event_type: "auto_paused",
    payload: { conversation_id: conversationId, reason },
  });
  console.log("funil auto-paused:", conversationId, reason);
  return true;
}
