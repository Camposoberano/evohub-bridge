// flow-state — onde cada contato parou dentro de um fluxo (migration 0014).
//
// Separado do campaigns.json de propósito: aquele é um arquivo lido e regravado inteiro, e
// num fluxo interativo cada resposta é uma escrita — duas respostas simultâneas fariam a
// segunda sobrescrever a primeira, e o lead perderia o lugar na conversa.
import { publicTable, type DbClient } from "./supabase.ts";
import { equivalentBrazilianPhoneKeys } from "./phone-keys.ts";
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
  extra?: { conversationId?: string | null; channelId?: string | null; flowRef?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {
    campaign_id: campaignId,
    contact_key: contactKey(contact),
    conversation_id: extra?.conversationId ?? null,
    channel_id: extra?.channelId ?? null,
    step_id: position.stepId,
    waiting_since: position.waitingSince ?? null,
    status: position.done || !position.stepId ? "done" : "waiting",
    updated_at: new Date().toISOString(),
  };
  // `flow_ref` (nó goto, migration 0018) só entra no upsert quando o chamador passa — e ele só
  // passa com FLOW_GOTO_ENABLED (= migration já aplicada). Omitido → a coluna nem é referenciada,
  // então o código roda normal antes da migration existir.
  if (extra?.flowRef !== undefined) row.flow_ref = extra.flowRef;
  const { error } = await publicTable(db, "campaign_flow_state")
    .upsert(row, { onConflict: "campaign_id,contact_key" });
  if (error) throw error;
}

/**
 * Lê o `flow_ref` do contato (nó goto): qual fluxo publicado ele passou a seguir. Isolado e
 * tolerante — se a coluna ainda não existe (migration 0018 não aplicada) devolve null em vez de
 * quebrar. Só é chamado com FLOW_GOTO_ENABLED.
 */
export async function flowRefDoContato(
  db: DbClient,
  campaignId: string,
  contact: string,
): Promise<string | null> {
  try {
    const { data } = await publicTable(db, "campaign_flow_state")
      .select("flow_ref")
      .eq("campaign_id", campaignId)
      .eq("contact_key", contactKey(contact))
      .maybeSingle();
    return (data?.flow_ref as string | null) ?? null;
  } catch {
    return null;
  }
}

// ── Gatilho de fluxo na resposta (migration 0023) ───────────────────────────
// Campanha "modo gatilho" manda o 1º toque e ARMA aqui; a resposta do lead inicia o fluxo.

/** Arma o gatilho pra (campanha, contato): após o 1º toque, a resposta vai iniciar o fluxo. */
export async function armarGatilho(
  db: DbClient,
  campaignId: string,
  channelId: string,
  contact: string,
): Promise<void> {
  const { error } = await publicTable(db, "flow_triggers").upsert({
    campaign_id: campaignId,
    channel_id: channelId,
    contact_key: contactKey(contact),
    status: "armed",
    armed_at: new Date().toISOString(),
    fired_at: null,
  }, { onConflict: "campaign_id,contact_key" });
  if (error) throw error;
}

/** Gatilho armado pra (canal, contato), se houver — o mais recente. */
export async function acharGatilhoArmado(
  db: DbClient,
  channelId: string,
  contact: string,
): Promise<{ id: string; campaignId: string } | null> {
  const { data } = await publicTable(db, "flow_triggers")
    .select("id,campaign_id")
    .eq("channel_id", channelId)
    .eq("contact_key", contactKey(contact))
    .eq("status", "armed")
    .order("armed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: String(data.id), campaignId: String(data.campaign_id) } : null;
}

/** Dispara o gatilho uma vez só: armed→done atômico. Quem perde a corrida recebe false. */
export async function claimGatilho(db: DbClient, id: string): Promise<boolean> {
  const { data, error } = await publicTable(db, "flow_triggers")
    .update({ status: "done", fired_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "armed")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/** Ignora a cópia de um segundo provedor da escolha do template depois que o gatilho disparou. */
export async function gatilhoDisparadoRecentemente(
  db: DbClient,
  channelId: string,
  contact: string,
  seconds = 30,
): Promise<boolean> {
  const since = new Date(Date.now() - seconds * 1000).toISOString();
  const { data, error } = await publicTable(db, "flow_triggers")
    .select("id")
    .eq("channel_id", channelId)
    .eq("contact_key", contactKey(contact))
    .eq("status", "done")
    .gte("fired_at", since)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

/**
 * Tenta reservar o passo para processar: só uma resposta ganha.
 *
 * `saveFlowPosition` antes de enviar não bastou. Ele evita o clique repetido com segundos de
 * intervalo, mas não dois eventos que chegam ao mesmo tempo: ambos leem `waiting` antes de
 * qualquer um gravar, e o ramo roda duas vezes. Foi o que apareceu no log — o mesmo
 * `necessidade -> isca` processado em duplicata.
 *
 * A trava é o próprio UPDATE: `status='waiting'` na condição faz o banco decidir. Quem
 * atualizar a linha ganha; o segundo não casa a condição, recebe zero linhas e desiste.
 */
export async function claimFlowStep(
  db: DbClient,
  campaignId: string,
  contact: string,
  stepId: string,
): Promise<boolean> {
  const { data, error } = await publicTable(db, "campaign_flow_state")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("contact_key", contactKey(contact))
    .eq("step_id", stepId)
    .eq("status", "waiting")
    .select("campaign_id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
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
  channelId?: string | null,
): Promise<FlowStateRow | null> {
  const { data, error } = await publicTable(db, "campaign_flow_state")
    .select(
      "campaign_id,contact_key,conversation_id,channel_id,step_id,waiting_since,status",
    )
    .eq("contact_key", contactKey(contact))
    .eq("status", "waiting")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = (data ?? []) as FlowStateRow[];
  if (!rows.length) return null;
  // Sem canal (chamada legada): mantém o comportamento antigo (o mais recente).
  if (channelId == null) return rows[0];
  // Com canal: SÓ avança o fluxo que pertence a ESTE canal — a resposta chegou por ele. Impede
  // que a resposta num canal faça o próximo passo sair por outro número, ou roube o fluxo de
  // outro canal (cenário multi-número). Linha legada sem channel_id gravado entra como fallback.
  const doCanal = rows.find((r) => String(r.channel_id ?? "") === String(channelId));
  if (doCanal) return doCanal;
  return rows.find((r) => r.channel_id == null) ?? null;
}

/**
 * Fluxo em espera neste canal cuja chave é uma VARIANTE de 9º dígito do número que respondeu.
 *
 * Por quê: a campanha pode ter gravado a espera com o número COM o 9º dígito (13) e a resposta
 * chegar SEM ele (12), ou vice-versa — são o mesmo celular. `findWaitingFlow` casa exato e não
 * encontra; o fluxo trava. O caminho LGT já reescreve a chave antes; aqui cobrimos os outros canais.
 *
 * SEGURANÇA — só casa quando é inequívoco: `equivalentBrazilianPhoneKeys` só gera par para celular
 * BR válido (a variante é o próprio número ±9º dígito, nunca um número distinto), e a guarda de
 * unicidade abaixo recusa se houver mais de uma chave em espera entre as variantes. O chamador
 * deve REESCREVER o `from` para `contact_key` do fluxo devolvido, senão claim/save/vars não casam.
 */
export async function findWaitingFlowPorVariante(
  db: DbClient,
  contact: string,
  channelId: string,
): Promise<FlowStateRow | null> {
  const variantes = equivalentBrazilianPhoneKeys(contact);
  if (variantes.length < 2) return null; // não é celular BR com par de 9º dígito
  const chaves = [...new Set(variantes.map((v) => contactKey(v)))];
  const { data, error } = await publicTable(db, "campaign_flow_state")
    .select(
      "campaign_id,contact_key,conversation_id,channel_id,step_id,waiting_since,status",
    )
    .in("contact_key", chaves)
    .eq("status", "waiting")
    .order("updated_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  const rows = ((data ?? []) as FlowStateRow[])
    .filter((r) => r.step_id && String(r.channel_id ?? "") === String(channelId));
  if (!rows.length) return null;
  // Guarda de unicidade: duas pessoas/campanhas distintas em espera entre as variantes → não
  // adivinha (pior caso = o fluxo segue preso, nunca avança pela chave errada).
  const chavesEmEspera = new Set(rows.map((r) => r.contact_key));
  if (chavesEmEspera.size !== 1) return null;
  return rows[0]; // mais recente (order by updated_at desc)
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
  const { data, error } = await publicTable(db, "campaign_flow_state")
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
