// flow-state — onde cada contato parou dentro de um fluxo (migration 0014).
//
// Separado do campaigns.json de propósito: aquele é um arquivo lido e regravado inteiro, e
// num fluxo interativo cada resposta é uma escrita — duas respostas simultâneas fariam a
// segunda sobrescrever a primeira, e o lead perderia o lugar na conversa.
import type { DbClient } from "./supabase.ts";
import type { FlowPosition } from "./flow-runner.ts";

export type FlowStateRow = {
  campaign_id: string;
  contact_key: string;
  conversation_id: string | null;
  channel_id: string | null;
  step_id: string | null;
  waiting_since: string | null;
  status: "waiting" | "done";
};

/** Número só com dígitos — mesma normalização de campaigns.numKey. */
export function contactKey(n: string): string {
  return String(n).replace(/\D/g, "");
}

/**
 * Grava onde o fluxo parou. Upsert pela chave (campanha, contato): a linha é a unidade de
 * concorrência, então duas respostas ao mesmo tempo não se atropelam.
 */
export async function saveFlowPosition(
  db: DbClient,
  campaignId: string,
  contact: string,
  position: FlowPosition,
  extra?: { conversationId?: string | null; channelId?: string | null },
): Promise<void> {
  const { error } = await db.from("flow_state").upsert({
    campaign_id: campaignId,
    contact_key: contactKey(contact),
    conversation_id: extra?.conversationId ?? null,
    channel_id: extra?.channelId ?? null,
    step_id: position.stepId,
    waiting_since: position.waitingSince ?? null,
    status: position.done || !position.stepId ? "done" : "waiting",
    updated_at: new Date().toISOString(),
  }, { onConflict: "campaign_id,contact_key" });
  if (error) throw error;
}

/**
 * Fluxo em que este contato está aguardando, se houver.
 *
 * Um contato pode ter passado por várias campanhas; só interessa a que ainda espera
 * resposta. Mais de uma em espera seria erro de operação (duas campanhas mirando o mesmo
 * número) — nesse caso vale a mais recente, que é a conversa que o lead tem em mente.
 */
export async function findWaitingFlow(
  db: DbClient,
  contact: string,
): Promise<FlowStateRow | null> {
  const { data, error } = await db.from("flow_state")
    .select(
      "campaign_id,contact_key,conversation_id,channel_id,step_id,waiting_since,status",
    )
    .eq("contact_key", contactKey(contact))
    .eq("status", "waiting")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as FlowStateRow | null) ?? null;
}

/**
 * Quem está esperando há mais tempo que `minutosMax`, para o loop de timeout avaliar.
 *
 * O filtro fino (cada step tem seu próprio `timeoutMin`) fica com o chamador, que tem o
 * fluxo em mãos; aqui só se corta o que nem candidato é, para não trazer a tabela toda.
 */
export async function findExpiredWaits(
  db: DbClient,
  minutosMax: number,
  limite = 200,
  now = Date.now(),
): Promise<FlowStateRow[]> {
  const corte = new Date(now - minutosMax * 60_000).toISOString();
  const { data, error } = await db.from("flow_state")
    .select(
      "campaign_id,contact_key,conversation_id,channel_id,step_id,waiting_since,status",
    )
    .eq("status", "waiting")
    .not("waiting_since", "is", null)
    .lte("waiting_since", corte)
    .order("waiting_since", { ascending: true })
    .limit(limite);
  if (error) throw error;
  return (data ?? []) as FlowStateRow[];
}
