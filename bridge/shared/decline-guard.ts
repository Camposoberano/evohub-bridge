// decline-guard — marca outcome=lost quando o lead clica um botão de recusa explícito
// (ex.: "Não tenho interesse", "Agora não") num fluxo de campanha.
//
// Existe porque `outcome` no tipo FlowStep (shared/flow.ts:62) nunca é gravado — o motor
// para de mandar mensagem quando o lead recusa, mas não deixa rastro pra próxima campanha
// não incluir a mesma pessoa de novo. Sem isso, cada campanha nova (Mega Sorgo, e as que
// vierem depois) precisaria repetir manualmente a varredura de exclusão.
//
// Só pega recusa por CLIQUE em botão com o texto exato — texto livre ("não gostei", "prefiro
// o milho") fica fora de propósito: isso é reconhecimento de linguagem, não string match, e
// não é o escopo deste guarda. Widen a lista abaixo à medida que novos fluxos usarem outros
// textos de botão pra recusa.
import type { DbClient } from "./supabase.ts";

export const DECLINE_BUTTON_TEXTS = [
  "Não tenho interesse",
  "Agora não",
  "Sem interesse",
] as const;

export type DeclineGuardResult = { checked: number; marked: number };

/**
 * Varre mensagens inbound recentes com texto de recusa e marca a conversa como `lost`,
 * só se ainda estiver `open` (nunca sobrescreve um outcome já definido — won ou lost por
 * outro caminho tem prioridade).
 *
 * `lookbackMinutes` limita o escopo pra rodar barato em loop — não precisa reler o histórico
 * inteiro a cada tick, só o que pode ter chegado desde a última passada.
 */
export async function runDeclineGuard(
  db: DbClient,
  lookbackMinutes = 15,
): Promise<DeclineGuardResult> {
  const cutoff = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();
  const { data: msgs, error } = await db.from("messages")
    .select("conversation_id")
    .eq("direction", "in")
    .in("content", DECLINE_BUTTON_TEXTS as unknown as string[])
    .gte("sent_at", cutoff);
  if (error) throw error;

  const convIds = [
    ...new Set(
      (msgs ?? []).map((m: { conversation_id: string | null }) =>
        m.conversation_id
      ).filter(Boolean),
    ),
  ] as string[];
  if (!convIds.length) return { checked: 0, marked: 0 };

  let marked = 0;
  for (const id of convIds) {
    const { data, error: upErr } = await db.from("conversations")
      .update({
        outcome: "lost",
        outcome_source: "decline-guard",
        outcome_set_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("outcome", "open")
      .select("id");
    if (upErr) {
      console.warn("decline-guard: erro marcando", id, upErr.message);
      continue;
    }
    if (data?.length) marked++;
  }
  return { checked: convIds.length, marked };
}
