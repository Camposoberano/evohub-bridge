// recovery-chain — dispara sozinho as 4 recuperações depois que o funil termina.
//
// Antes disso a recuperação existia mas era macro manual, e o resultado apareceu nos
// números de 03/08: variação 1 com 72 envios, variação 4 com 1. Ninguém volta na conversa
// quatro vezes na mão. O conteúdo e o envio já estavam prontos (recovery-content.ts,
// recovery-template.ts, dispatchRecovery); o que faltava era o relógio.
//
// Cadência 1·2·4·7 dias a partir do fim do funil: densa no começo, quando o lead ainda
// lembra, e espaçando depois pra não virar perseguição.
import type { DbClient } from "./supabase.ts";
import { isClosedOutcome } from "./outcome-labels.ts";

type Json = Record<string, unknown>;

/** dia (após o fim do funil) em que cada variação vence. Índice 0 = variação 1. */
export const RECOVERY_CHAIN_DAYS = [1, 2, 4, 7] as const;

const DIA_MS = 24 * 60 * 60_000;
/** Nunca duas recuperações no mesmo dia. Sem isso, uma conversa parada há 10 dias levaria
 *  as 4 variações em rajada, uma a cada rodada do loop. */
const GAP_MINIMO_MS = 20 * 60 * 60_000;
/** Conversa parada há mais de 30 dias não é recuperação, é lista fria. */
const IDADE_MAXIMA_MS = 30 * DIA_MS;

const BRT_OFFSET_MS = 3 * 60 * 60_000;
/** O funil roda 6h-22h, mas recuperação é mensagem fria depois de dias de silêncio —
 *  6h da manhã incomoda. 8h-20h. */
const ABRE_H = 8;
const FECHA_H = 20;

export function withinRecoveryHours(now: number): boolean {
  const h = new Date(now - BRT_OFFSET_MS).getUTCHours();
  return h >= ABRE_H && h < FECHA_H;
}

export type RecoveryDecision = {
  now: number;
  /** quando o funil mandou a última peça */
  funnelEndedAt: number;
  /** última mensagem DO LEAD, ou null se nunca respondeu */
  lastInboundAt: number | null;
  /** quando saiu a última recuperação, ou null */
  lastRecoveryAt: number | null;
  /** variações já enviadas pra essa conversa */
  sentVariations: number[];
  outcome?: string | null;
};

/**
 * Qual variação deve sair agora, ou null. Pura de propósito: é a regra que decide mandar
 * mensagem pra cliente de verdade, então precisa ser testável sem banco.
 */
export function dueRecoveryVariation(input: RecoveryDecision): number | null {
  // Venda ganha ou perdida encerra o assunto. Recuperar quem já comprou queima o cliente.
  // isClosedOutcome, não `if (outcome)`: a coluna é NOT NULL com default 'open'.
  if (isClosedOutcome(input.outcome)) return null;

  // Lead que respondeu depois do funil não está silencioso — está em conversa. Quem cuida
  // dele é o atendente ou o follow-up, não a recuperação.
  if (input.lastInboundAt && input.lastInboundAt > input.funnelEndedAt) {
    return null;
  }

  const idade = input.now - input.funnelEndedAt;
  if (idade < 0 || idade > IDADE_MAXIMA_MS) return null;

  if (
    input.lastRecoveryAt !== null &&
    input.now - input.lastRecoveryAt < GAP_MINIMO_MS
  ) {
    return null;
  }

  const enviadas = new Set(input.sentVariations);
  const diasCorridos = idade / DIA_MS;
  // Menor variação ainda não enviada cuja data já venceu: a ordem importa, os quatro
  // ângulos contam uma história (retomada -> vídeos -> dúvida -> última chamada).
  for (let v = 1; v <= RECOVERY_CHAIN_DAYS.length; v++) {
    if (enviadas.has(v)) continue;
    if (diasCorridos >= RECOVERY_CHAIN_DAYS[v - 1]) return v;
    break; // vence em ordem; se a variação v ainda não venceu, as seguintes também não
  }
  return null;
}

export type RecoveryChainResult = {
  scanned: number;
  due: number;
  sent: number;
  failed: number;
};

/** Envia de fato. Injetado pra manter este módulo livre de import circular com
 *  funil-control.ts e testável sem rede. Devolve true se a mensagem saiu. */
export type RecoveryDispatcher = (
  conversation: Json,
  cwConvId: number,
  variation: number,
) => Promise<boolean>;

/**
 * Varre os funis terminados e dispara a recuperação vencida.
 *
 * O teto por rodada é a trava mais importante daqui. Ao ligar pela primeira vez existe um
 * represado grande (87 conversas elegíveis em 04/08), e o loop roda de 5 em 5 min: com
 * teto 15 isso viraria 180 templates frios por hora e a Meta rebaixa a nota de qualidade
 * do número por muito menos. Padrão 5 (60/h) esvazia o represado em ~1h30 sem rajada;
 * sobe pelo RECOVERY_CHAIN_MAX_PER_ROUND depois que a nota se mostrar estável.
 */
export async function pumpRecoveryChain(
  db: DbClient,
  dispatch: RecoveryDispatcher,
  now = Date.now(),
  maxPorRodada = 5,
): Promise<RecoveryChainResult> {
  const result = { scanned: 0, due: 0, sent: 0, failed: 0 };
  if (!withinRecoveryHours(now)) return result;

  const { data: sequences, error } = await db.from("sales_sequences")
    .select("conversation_id,chatwoot_conversation_id,last_sent_at")
    .eq("funnel", "mega-sorgo")
    .eq("status", "completed")
    .gte("last_sent_at", new Date(now - IDADE_MAXIMA_MS).toISOString())
    .order("last_sent_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  if (!sequences?.length) return result;

  const ids = (sequences as Json[]).map((s) => String(s.conversation_id));
  const [{ data: conversations }, { data: recoveryEvents }] = await Promise.all(
    [
      db.from("conversations").select("id,outcome").in("id", ids),
      db.from("events")
        .select("received_at,payload")
        .eq("source", "recovery")
        .eq("event_type", "recovery_sent")
        .gte("received_at", new Date(now - IDADE_MAXIMA_MS).toISOString())
        .order("received_at", { ascending: false })
        .limit(5_000),
    ],
  );
  const outcomeById = new Map(
    ((conversations ?? []) as Json[]).map((c) => [
      String(c.id),
      (c.outcome as string | null) ?? null,
    ]),
  );
  const enviadasPorConversa = new Map<string, number[]>();
  const ultimaPorConversa = new Map<string, number>();
  for (const ev of (recoveryEvents ?? []) as Json[]) {
    const payload = (ev.payload as Json | undefined) ?? {};
    const id = String(payload.conversation_id ?? "");
    if (!id) continue;
    const v = Number(payload.variation ?? 0);
    if (v >= 1) {
      const lista = enviadasPorConversa.get(id) ?? [];
      lista.push(v);
      enviadasPorConversa.set(id, lista);
    }
    const at = Date.parse(String(ev.received_at));
    // ordenado do mais novo pro mais velho: o primeiro que aparece é o último enviado
    if (Number.isFinite(at) && !ultimaPorConversa.has(id)) {
      ultimaPorConversa.set(id, at);
    }
  }

  for (const sequence of sequences as Json[]) {
    if (result.sent >= maxPorRodada) break;
    result.scanned++;
    const conversationId = String(sequence.conversation_id);
    const cwConvId = Number(sequence.chatwoot_conversation_id ?? 0);
    const funnelEndedAt = Date.parse(String(sequence.last_sent_at ?? ""));
    if (!cwConvId || !Number.isFinite(funnelEndedAt)) continue;

    const { data: inbound } = await db.from("messages")
      .select("sent_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "in")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const variation = dueRecoveryVariation({
      now,
      funnelEndedAt,
      lastInboundAt: inbound?.sent_at
        ? Date.parse(String(inbound.sent_at))
        : null,
      lastRecoveryAt: ultimaPorConversa.get(conversationId) ?? null,
      sentVariations: enviadasPorConversa.get(conversationId) ?? [],
      outcome: outcomeById.get(conversationId) ?? null,
    });
    if (!variation) continue;
    result.due++;

    try {
      const { data: conv } = await db.from("conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (!conv) continue;
      if (await dispatch(conv as Json, cwConvId, variation)) result.sent++;
      else result.failed++;
    } catch (e) {
      result.failed++;
      console.error(
        `recovery-chain: conversa ${conversationId} variação ${variation}:`,
        e,
      );
    }
  }
  return result;
}
