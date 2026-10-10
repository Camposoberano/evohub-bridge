import { admin } from "./supabase.ts";
import { chaveDaPausa, limparPausa, marcarPausa } from "./funil-pausa.ts";
import {
  deveAdiarPausaDaAbertura,
  devePausarFunilRestaurado,
} from "./funil-anuncio.ts";
import {
  AD_5895_FUNNEL,
  mainFunnelForConversation,
  RESTORED_5895_FUNNEL,
} from "./funnel-identity.ts";

/** A request may replace a stale sequence only when no queue or sent-opening evidence exists. */
export function canRecreateMissingOpening(input: {
  requested: boolean;
  hasSequence: boolean;
  hasDeliveryEvidence: boolean;
}): boolean {
  return input.requested && input.hasSequence && !input.hasDeliveryEvidence;
}

/** Any non-deferred queue row or historical opening message blocks a full re-enrollment. */
export async function hasFunnelDeliveryEvidence(
  db: ReturnType<typeof admin>,
  conversationId: string,
  funnel?: string,
): Promise<boolean> {
  const funnelId = funnel ??
    await mainFunnelForConversation(db, conversationId);
  const { data: queue, error: queueError } = await db
    .from("scheduled_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("funnel", funnelId)
    .neq("type", "deferred_intent")
    .limit(1);
  if (queueError) throw queueError;
  if (queue?.length) return true;

  const [intro, menu] = await Promise.all([
    db.from("messages").select("id").eq("conversation_id", conversationId)
      .eq("direction", "out").eq("funnel", funnelId)
      .ilike(
        "content",
        funnelId === AD_5895_FUNNEL
          ? "%Vi que você chegou pelo anúncio do Mega Sorgo%"
          : "%Olá! Aqui é o Cícero%",
      )
      .limit(1),
    funnelId === AD_5895_FUNNEL
      ? Promise.resolve({ data: [], error: null })
      : db.from("messages").select("id").eq("conversation_id", conversationId)
        .eq("direction", "out").ilike("content", "%Como posso ajudar?%")
        .limit(1),
  ]);
  if (intro.error) throw intro.error;
  if (menu.error) throw menu.error;
  return Boolean(intro.data?.length || menu.data?.length);
}

async function hasPendingOpeningMessages(
  db: ReturnType<typeof admin>,
  conversationId: string,
  funnel: string,
): Promise<boolean> {
  const { data, error } = await db.from("scheduled_messages").select("id,type")
    .eq("conversation_id", conversationId).eq("funnel", funnel)
    .eq("day", 1).in("status", ["pending", "paused"]).limit(100);
  if (error) throw error;
  return (data ?? []).some((row: Record<string, unknown>) =>
    row.type !== "deferred_intent"
  );
}

/** A rota inicial só pode avançar quando todas as peças da abertura saíram. */
export async function openingMessagesComplete(
  db: ReturnType<typeof admin>,
  conversationId: string,
  funnel?: string,
): Promise<boolean> {
  const funnelId = funnel ??
    await mainFunnelForConversation(db, conversationId);
  const { data, error } = await db.from("scheduled_messages")
    .select("id,status,type")
    .eq("conversation_id", conversationId).eq("funnel", funnelId)
    .eq("day", 1).limit(100);
  if (error) throw error;
  const openingRows = (data ?? []).filter((row: Record<string, unknown>) =>
    row.type !== "deferred_intent"
  );
  if (openingRows.length) {
    return openingRows.every((row: Record<string, unknown>) =>
      row.status === "sent"
    );
  }

  // Compatibilidade com conversas antigas, cujas peças já enviadas podem não
  // permanecer na fila. Não considera completa uma sequência sem evidência de envio.
  const [intro, menu] = await Promise.all([
    db.from("messages").select("id").eq("conversation_id", conversationId)
      .eq("direction", "out").eq("funnel", funnelId)
      .ilike(
        "content",
        funnelId === AD_5895_FUNNEL
          ? "%Vi que você chegou pelo anúncio do Mega Sorgo%"
          : "%Olá! Aqui é o Cícero%",
      )
      .limit(1),
    funnelId === AD_5895_FUNNEL
      ? Promise.resolve({ data: [], error: null })
      : db.from("messages").select("id").eq("conversation_id", conversationId)
        .eq("direction", "out").ilike("content", "%Como posso ajudar?%")
        .limit(1),
  ]);
  if (intro.error) throw intro.error;
  if (menu.error) throw menu.error;
  return Boolean(intro.data?.length && menu.data?.length);
}

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
  opts: { comPrazo?: boolean; adOrigin?: boolean; funnel?: string } = {},
): Promise<boolean> {
  // `comPrazo: false` = pausa que NAO se retoma sozinha. Serve para quem pediu falar com uma
  // pessoa: devolver o funil em 2h por cima de quem esta esperando atendente e exatamente a
  // reclamacao que originou isto (13/09: 2 conversas receberam 19 e 15 pecas depois do pedido).
  const comPrazo = opts.comPrazo !== false;
  const db = admin();
  const funnel = opts.funnel ??
    await mainFunnelForConversation(db, conversationId);
  if (
    deveAdiarPausaDaAbertura(
      await hasPendingOpeningMessages(db, conversationId, funnel),
      opts.adOrigin === true,
    )
  ) {
    console.log(
      "funil auto-pause adiado: abertura principal ainda tem mensagens pendentes",
      conversationId,
    );
    return false;
  }
  const { data: seq } = await db.from("sales_sequences").select("id, status")
    .eq("conversation_id", conversationId).in("status", ["running", "paused"])
    .eq("funnel", funnel)
    .maybeSingle();
  if (!seq) return false;

  // A cópia de 30/09 continua durante preço, dúvida e respostas. Classificações
  // genéricas de handoff não equivalem a um pedido explícito do cliente.
  if (funnel === RESTORED_5895_FUNNEL &&
    !devePausarFunilRestaurado(reason)) {
    return false;
  }

  // Uma resposta processada diretamente substitui a rota que aguardava abertura,
  // inclusive quando a sequência foi pausada manualmente.
  const { error: deferredError } = await db.from("scheduled_messages")
    .update({ status: "cancelled" }).eq("conversation_id", conversationId)
    .eq("funnel", funnel).eq("type", "deferred_intent")
    .in("status", ["pending", "paused"]);
  if (deferredError) throw deferredError;

  // Uma pausa manual ou handoff sem marcador não pode virar temporária só porque o
  // cliente mandou outra mensagem enquanto aguarda o atendente.
  if (seq.status === "paused" && comPrazo) {
    const { data: timedPause, error: pauseError } = await db.from("deliveries")
      .select("delivery_id")
      .eq("delivery_id", chaveDaPausa(conversationId))
      .eq("source", "funil-pausa-preco")
      .maybeSingle();
    if (pauseError || !timedPause) return false;
  }

  await db.from("scheduled_messages").update({ status: "paused" })
    .eq("conversation_id", conversationId).eq("funnel", funnel)
    .eq("status", "pending");
  await db.from("sales_sequences").update({ status: "paused" }).eq(
    "id",
    seq.id,
  );
  await db.from("events").insert({
    source: "funil",
    event_type: "auto_paused",
    payload: { conversation_id: conversationId, reason, com_prazo: comPrazo },
  });
  if (comPrazo) await marcarPausa(db, conversationId);
  else await limparPausa(db, conversationId);
  console.log(
    "funil auto-paused:",
    conversationId,
    reason,
    comPrazo ? "(com prazo de retomada)" : "(SEM prazo - espera atendente)",
  );
  return true;
}
