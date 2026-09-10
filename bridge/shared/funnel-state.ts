import { admin } from "./supabase.ts";
import { marcarPausa } from "./funil-pausa.ts";

// Pausa somente a sequencia Mega Sorgo ativa da conversa. O motivo fica
// registrado para auditoria e para uma retomada deliberada pelo atendente.
//
// A pausa passou a ter PRAZO em 10/09. Antes ela era definitiva e nada a retomava: quem
// perguntava o preço — o maior sinal de compra que existe — saía da sequência para sempre.
// Eram 3.555 peças e 144 sequências paradas assim, mais de duzentas num único dia.
// Agora fica um marcador em `deliveries`, e o laço de retomada devolve a conversa ao funil
// quando o prazo vence sem fechamento.
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
  await marcarPausa(db, conversationId);
  console.log("funil auto-paused:", conversationId, reason, "(com prazo de retomada)");
  return true;
}
