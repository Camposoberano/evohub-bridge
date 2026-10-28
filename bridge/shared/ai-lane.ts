// ai-lane — "lane de IA" do funil agro. Quando o texto livre do lead NÃO casa com
// nenhuma porta determinística (fluxo, menu, preço/vídeo/plantio/nutrição), a conversa
// é entregue ao agente fazer.ai ("Vendedor Agro"). O ESTADO da lane é a label
// `ai-vendas` no Chatwoot — visível pro operador e consultada pelo /ai-gate.
//
// Boundary (decisão de 2026-10-28): o determinístico continua dono de TUDO
// (templates, botões, campanha, recovery, fechamento). A IA só entra no texto livre
// que o funil não converte. Entrar na lane = adicionar a label; o agente fazer.ai
// consulta /ai-gate (contactAuth) antes de cada resposta e só fala se a label estiver
// lá e o bot não estiver calado (`bot-off`).
import {
  type CwAcct,
  getConversationLabels,
  setConversationLabels,
} from "./chatwoot.ts";
import { optionalEnv } from "./env.ts";
import type { DbClient } from "./supabase.ts";

export const AI_LANE_LABEL = "ai-vendas";

// Flag de deploy: a lane começa DESLIGADA. Ligar só com o /ai-gate no ar e o agente
// fazer.ai bindado na inbox — senão a label é setada e ninguém responde (lead no vácuo).
export function aiLaneEnabled(): boolean {
  const v = optionalEnv("AI_LANE_ENABLED");
  return v === "1" || v === "true";
}

export function hasAiLaneLabel(labels: readonly string[]): boolean {
  return labels.includes(AI_LANE_LABEL);
}

export function withAiLaneLabel(labels: readonly string[]): string[] {
  return hasAiLaneLabel(labels) ? [...labels] : [...labels, AI_LANE_LABEL];
}

export function withoutAiLaneLabel(labels: readonly string[]): string[] {
  return labels.filter((l) => l !== AI_LANE_LABEL);
}

// Adiciona a label `ai-vendas` à conversa (preserva as demais — o Chatwoot só aceita
// substituir o conjunto inteiro). Não lança: falhar aqui não pode derrubar o atendimento.
export async function enterAiLane(
  cwConversationId: number,
  acct: CwAcct,
): Promise<boolean> {
  try {
    const labels = await getConversationLabels(cwConversationId, acct);
    if (hasAiLaneLabel(labels)) return true;
    await setConversationLabels(cwConversationId, withAiLaneLabel(labels), acct);
    return true;
  } catch (e) {
    console.warn(
      `enterAiLane ${cwConversationId} falhou:`,
      String(e).slice(0, 160),
    );
    return false;
  }
}

// Remove a label `ai-vendas` (handoff pro humano, fechamento, desfecho). Não lança.
export async function exitAiLane(
  cwConversationId: number,
  acct: CwAcct,
): Promise<boolean> {
  try {
    const labels = await getConversationLabels(cwConversationId, acct);
    if (!hasAiLaneLabel(labels)) return true;
    await setConversationLabels(
      cwConversationId,
      withoutAiLaneLabel(labels),
      acct,
    );
    return true;
  } catch (e) {
    console.warn(
      `exitAiLane ${cwConversationId} falhou:`,
      String(e).slice(0, 160),
    );
    return false;
  }
}

// Resolve a conversa ativa (não resolvida) de um contato e devolve o
// chatwoot_conversation_id — a chave que o /ai-gate e os webhooks usam pra mexer na label.
export async function activeChatwootConversationId(
  db: DbClient,
  channelId: string,
  externalContactId: string,
): Promise<number | null> {
  const { data: contact } = await db.from("contacts").select("id")
    .eq("channel_id", channelId)
    .eq("external_contact_id", externalContactId).maybeSingle();
  if (!contact) return null;
  const { data: conv } = await db.from("conversations")
    .select("chatwoot_conversation_id")
    .eq("contact_id", contact.id).neq("status", "resolved")
    .order("opened_at", { ascending: false }).limit(1).maybeSingle();
  const id = conv?.chatwoot_conversation_id as number | null | undefined;
  return (typeof id === "number" && id > 0) ? id : null;
}

// Entrega o contato pra lane de IA: resolve a conversa ativa e seta a label.
// Devolve false (sem efeito) se não houver conversa com id do Chatwoot ainda.
export async function routeContactToAiLane(
  db: DbClient,
  channelId: string,
  externalContactId: string,
  acct: CwAcct,
): Promise<boolean> {
  const cwId = await activeChatwootConversationId(db, channelId, externalContactId);
  if (!cwId) return false;
  return await enterAiLane(cwId, acct);
}
