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
  opts: { comPrazo?: boolean } = {},
): Promise<boolean> {
  // `comPrazo: false` = pausa que NAO se retoma sozinha. Serve para quem pediu falar com uma
  // pessoa: devolver o funil em 2h por cima de quem esta esperando atendente e exatamente a
  // reclamacao que originou isto (13/09: 2 conversas receberam 19 e 15 pecas depois do pedido).
  const comPrazo = opts.comPrazo !== false;
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
  if (comPrazo) await marcarPausa(db, conversationId);
  console.log(
    "funil auto-paused:",
    conversationId,
    reason,
    comPrazo ? "(com prazo de retomada)" : "(SEM prazo - espera atendente)",
  );
  return true;
}
