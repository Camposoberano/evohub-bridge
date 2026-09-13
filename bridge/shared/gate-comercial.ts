// gate-comercial — "esta conversa ainda pode receber automação?"
//
// A regra do dono é simples: quem já pagou e quem disse que não compra saem de TODA cadeia
// automática. Quem marca isso é o atendente, colocando a etiqueta no WhatsApp/Chatwoot.
//
// A tradução etiqueta → desfecho já existia (`outcome-labels.ts`) e funciona: em 13/09,
// 202 de 202 conversas etiquetadas tinham o `outcome` certo. O que faltava era alguém LER
// isso antes de disparar. O funil lia; a recuperação passou a ler em 12/09; a campanha não
// lia em lugar nenhum — nem na fila inicial, nem na continuação por timeout. Resultado
// medido em 13/09: 8 conversas com `wa:não compra` receberam "Meu amigo, não quero
// incomodar…" depois de etiquetadas, uma delas no mesmo dia desta leitura.
//
// Duas decisões que não são detalhe:
//
// 1. Lê a ETIQUETA além do `outcome`. O `outcome` é derivado por um loop de 10 em 10
//    minutos; nessa janela a conversa já está marcada e ainda dispararia. Ler os dois
//    fecha a janela sem depender do sync.
// 2. Erro BLOQUEIA, não libera. É o oposto do `bot-mute`, e de propósito: em 11 e 12/09 a
//    mesma classe de falha (consulta estourando a URL, erro lido como lista vazia) fez
//    "ninguém comprou" virar verdade e a recuperação saiu para 224 conversas, 6 delas com
//    venda ganha. Não saber se o cliente comprou é motivo para não mandar.
import type { DbClient } from "./supabase.ts";
import { consultaEmLotes } from "./lotes.ts";
import { deriveOutcome, isClosedOutcome, type Outcome } from "./outcome-labels.ts";

type Json = Record<string, unknown>;

/** Motivo pelo qual a conversa está fora das cadeias automáticas, ou `null` se está em jogo. */
export type Bloqueio = Outcome;

/** Rótulo curto para `last_error`, log e evento. */
export function motivoDoBloqueio(b: Bloqueio): string {
  return b === "won" ? "ja-comprou" : "nao-compra";
}

/**
 * Decisão a partir do que está gravado na conversa.
 *
 * `outcome` e etiqueta são lidos juntos porque chegam em tempos diferentes: a etiqueta é
 * imediata (o atendente acabou de pôr) e o `outcome` vem do sync de 10 minutos.
 */
export function bloqueioDaConversa(conv: {
  outcome?: unknown;
  labels?: unknown;
}): Bloqueio | null {
  const outcome = typeof conv.outcome === "string" ? conv.outcome : null;
  if (isClosedOutcome(outcome)) return outcome as Outcome;
  const labels = Array.isArray(conv.labels) ? conv.labels.map((l) => String(l)) : [];
  return labels.length ? deriveOutcome(labels) : null;
}

/**
 * Quais destas conversas estão fora, por id.
 *
 * Em lotes porque `.in()` com lista grande estoura a URL do PostgREST (502 por volta de
 * 3 KB, 414 por volta de 18 KB) — e o erro SOBE: sem saber quem comprou, o chamador para,
 * em vez de tratar a lista vazia como "ninguém comprou".
 */
export async function bloqueiosPorConversa(
  db: DbClient,
  conversationIds: string[],
): Promise<Map<string, Bloqueio>> {
  const fora = new Map<string, Bloqueio>();
  if (!conversationIds.length) return fora;
  const linhas = await consultaEmLotes<Json>(
    conversationIds,
    (lote) =>
      db.from("conversations").select("id,outcome,labels").in("id", lote),
  );
  for (const c of linhas) {
    const b = bloqueioDaConversa(c);
    if (b) fora.set(String(c.id), b);
  }
  return fora;
}

/**
 * Mesma decisão, mas partindo do TELEFONE — é assim que a campanha identifica o contato
 * (`contact_key` é o `external_contact_id`, não um uuid de conversa; confundir os dois já
 * derrubou a campanha inteira com `22P02` em cima do bot-mute).
 *
 * Diferente do `isBotMutedForContact`, um erro aqui é lançado em vez de virar "pode
 * mandar": o chamador precisa decidir explicitamente o que fazer sem a informação.
 */
export async function bloqueioPorContato(
  db: DbClient,
  channelId: string,
  externalContactId: string,
): Promise<Bloqueio | null> {
  const { data: contact, error: errContato } = await db.from("contacts")
    .select("id")
    .eq("channel_id", channelId)
    .eq("external_contact_id", externalContactId)
    .maybeSingle();
  if (errContato) throw errContato;
  if (!contact) return null;

  // Todas as conversas do contato, não só a aberta: "pago" costuma estar na conversa que
  // foi resolvida quando a venda fechou, e é exatamente essa que não pode receber isca.
  const { data: convs, error } = await db.from("conversations")
    .select("outcome,labels")
    .eq("contact_id", (contact as Json).id)
    .order("opened_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  let lost: Bloqueio | null = null;
  for (const c of (convs ?? []) as Json[]) {
    const b = bloqueioDaConversa(c);
    if (b === "won") return "won"; // venda registrada é fato e vence
    if (b === "lost") lost = "lost";
  }
  return lost;
}
