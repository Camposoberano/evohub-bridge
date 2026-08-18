// campaign-queue — enfileira os contatos de uma campanha e entrega um por vez, no ritmo.
//
// Existe porque `start-fluxo` é síncrono: com o intervalo humano que a operação exige (4 a 17
// minutos entre contatos), 200 contatos levariam 14 horas numa request HTTP. Enfileirar faz a
// chamada devolver na hora, e o loop consome — sobrevivendo a restart do container.
import type { DbClient } from "./supabase.ts";
import { inicioDoDiaBrt } from "./campaign-pace.ts";

type Json = Record<string, unknown>;

/** Tentativas antes de desistir de um contato. Evita fila travada num número ruim. */
const MAX_TENTATIVAS = 3;

export type FilaItem = {
  id: string;
  campaign_id: string;
  contact_key: string;
  channel_id: string | null;
  attempts: number;
};

/**
 * Põe a lista na fila. Ignora repetido pelo unique (campaign_id, contact_key): disparar a
 * mesma campanha duas vezes para a mesma lista não duplica ninguém.
 */
export async function enfileirar(
  db: DbClient,
  campaignId: string,
  contatos: string[],
  channelId: string,
): Promise<number> {
  const linhas = [...new Set(contatos.map((c) => c.replace(/\D/g, "")))]
    .filter((c) => c.length >= 12)
    .map((contact_key) => ({
      campaign_id: campaignId,
      contact_key,
      channel_id: channelId,
      status: "pending",
    }));
  if (!linhas.length) return 0;
  const { error } = await db.from("campaign_queue")
    .upsert(linhas, { onConflict: "campaign_id,contact_key", ignoreDuplicates: true });
  if (error) throw error;
  return linhas.length;
}

/** Próximo da fila, na ordem em que entrou. */
export async function proximoDaFila(
  db: DbClient,
  campaignId: string,
): Promise<FilaItem | null> {
  const { data, error } = await db.from("campaign_queue")
    .select("id,campaign_id,contact_key,channel_id,attempts")
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .lt("attempts", MAX_TENTATIVAS)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as FilaItem | null) ?? null;
}

/** Quantos já saíram hoje nesta campanha — base do teto diário. */
export async function enviadosHoje(
  db: DbClient,
  campaignId: string,
  now = Date.now(),
): Promise<number> {
  const { count, error } = await db.from("campaign_queue")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
    .gte("sent_at", inicioDoDiaBrt(now));
  if (error) throw error;
  return count ?? 0;
}

/** Quando saiu o último — base do intervalo entre contatos. */
export async function ultimoEnvioAt(
  db: DbClient,
  campaignId: string,
): Promise<number | null> {
  const { data, error } = await db.from("campaign_queue")
    .select("sent_at")
    .eq("campaign_id", campaignId)
    .eq("status", "sent")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const at = data?.sent_at ? Date.parse(String(data.sent_at)) : NaN;
  return Number.isFinite(at) ? at : null;
}

/**
 * Reserva o item antes de enviar. Mesma trava de `claimFlowStep`: o UPDATE exige
 * `status='pending'`, então dois ticks do loop não pegam o mesmo contato.
 */
export async function reservarItem(
  db: DbClient,
  id: string,
): Promise<boolean> {
  const { data, error } = await db.from("campaign_queue")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

export async function marcarEnviado(
  db: DbClient,
  id: string,
  now = Date.now(),
): Promise<void> {
  await db.from("campaign_queue").update({
    status: "sent",
    sent_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  }).eq("id", id);
}

/**
 * Devolve para a fila contando a tentativa. Ao atingir `MAX_TENTATIVAS` o item some do
 * `proximoDaFila` (filtro `attempts <`), então um número ruim não trava a campanha inteira.
 */
export async function marcarFalha(
  db: DbClient,
  item: FilaItem,
  erro: string,
): Promise<void> {
  const tentativas = item.attempts + 1;
  await db.from("campaign_queue").update({
    status: tentativas >= MAX_TENTATIVAS ? "failed" : "pending",
    attempts: tentativas,
    last_error: erro.slice(0, 300),
    updated_at: new Date().toISOString(),
  }).eq("id", item.id);
}

/** Contato que não deve receber: já comprou, disse não, ou o bot está travado nele. */
export async function marcarPulado(
  db: DbClient,
  id: string,
  motivo: string,
): Promise<void> {
  await db.from("campaign_queue").update({
    status: "skipped",
    last_error: motivo.slice(0, 300),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
}

/** Campanhas com fila pendente — o loop varre só essas. */
export async function campanhasComFila(db: DbClient): Promise<string[]> {
  const { data, error } = await db.from("campaign_queue")
    .select("campaign_id")
    .eq("status", "pending")
    .lt("attempts", MAX_TENTATIVAS)
    .limit(1000);
  if (error) throw error;
  return [...new Set(((data ?? []) as Json[]).map((r) => String(r.campaign_id)))];
}

/**
 * Pausa: tira da fila sem perder o lugar.
 *
 * `paused` não estava previsto na migration, mas a coluna é `text` — e o `proximoDaFila`
 * filtra por `pending`, então basta mudar o rótulo para o loop parar de pegar. Quem já saiu
 * não volta atrás: pausar afeta só quem ainda não recebeu.
 */
export async function pausarCampanha(
  db: DbClient,
  campaignId: string,
): Promise<number> {
  const { data, error } = await db.from("campaign_queue")
    .update({ status: "paused", updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Retoma de onde parou. O teto do dia continua valendo — retomar não libera rajada para
 * compensar o tempo parado, que seria justamente o comportamento que a rampa evita.
 */
export async function retomarCampanha(
  db: DbClient,
  campaignId: string,
): Promise<number> {
  const { data, error } = await db.from("campaign_queue")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("campaign_id", campaignId)
    .eq("status", "paused")
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Cancela o que falta. Diferente de pausar: não há como desfazer pelo painel — o registro
 * fica como `skipped` com o motivo, para a conta de quem recebeu continuar fechando.
 */
export async function cancelarCampanha(
  db: DbClient,
  campaignId: string,
  motivo = "cancelada no painel",
): Promise<number> {
  const { data, error } = await db.from("campaign_queue")
    .update({
      status: "skipped",
      last_error: motivo,
      updated_at: new Date().toISOString(),
    })
    .eq("campaign_id", campaignId)
    .in("status", ["pending", "paused"])
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export type ResumoFila = {
  pendentes: number;
  pausados: number;
  enviados: number;
  falhas: number;
  pulados: number;
};

export async function resumoDaFila(
  db: DbClient,
  campaignId: string,
): Promise<ResumoFila> {
  const { data, error } = await db.from("campaign_queue")
    .select("status")
    .eq("campaign_id", campaignId)
    .limit(10_000);
  if (error) throw error;
  const linhas = (data ?? []) as Json[];
  const conta = (s: string) => linhas.filter((r) => r.status === s).length;
  return {
    pendentes: conta("pending"),
    pausados: conta("paused"),
    enviados: conta("sent"),
    falhas: conta("failed"),
    pulados: conta("skipped"),
  };
}
