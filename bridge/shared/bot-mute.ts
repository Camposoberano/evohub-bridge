// bot-mute — trava manual do bot por conversa, comandada pela label `bot-off` no Chatwoot.
//
// Por que uma label persistente e não a macro `cmd-funil-pause` que já existia: o
// macro-poll apaga a label depois de executar, então não sobrava rastro — não dava pra
// olhar a lista do Chatwoot e ver quais conversas estavam paradas. E `cmd-funil-pause` só
// para o roteiro agendado; as respostas automáticas de preço/plantio continuavam saindo
// por cima do atendente. Aqui a label É o estado: enquanto estiver na conversa, o bot fica
// calado inteiro.
//
// O que a trava NÃO faz: bloquear `ingestInbound`. Mensagem do cliente continua sendo
// gravada e espelhada no Chatwoot — silenciar o bot não é parar de escutar o cliente.
import type { DbClient } from "./supabase.ts";

const POSTGREST_ID_BATCH_SIZE = 10;

function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

/** Label no Chatwoot que trava o bot. Persistente: some só quando o atendente remove. */
export const BOT_MUTE_LABEL = "bot-off";

/**
 * Quais destas conversas estão com o bot travado.
 *
 * Recebe o lote de ids e devolve um Set, em vez de checar uma por vez: os chamadores já
 * trabalham em lote (a fila do funil, a varredura da recuperação) e uma consulta por
 * mensagem multiplicaria round-trips no caminho de envio.
 *
 * Lista vazia devolve Set vazio sem ir ao banco — `.in()` com array vazio é consulta
 * desperdiçada.
 */
export async function mutedConversationIds(
  db: DbClient,
  conversationIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (!ids.length) return new Set();
  const responses = await Promise.all(
    batches(ids, POSTGREST_ID_BATCH_SIZE).map((batch) =>
      db.from("conversations")
        .select("id")
        .in("id", batch)
        .not("bot_muted_at", "is", null)
    ),
  );
  const muted = new Set<string>();
  for (const response of responses) {
    if (response.error) throw response.error;
    for (const row of (response.data ?? []) as { id: unknown }[]) {
      muted.add(String(row.id));
    }
  }
  return muted;
}

/**
 * Uma conversa só. Atalho para o caminho da mensagem que chega, onde o id é único.
 * Falha fechada como "não travado": se o banco oscilar, é melhor o bot responder do que
 * emudecer todo mundo em silêncio — a trava é exceção, o atendimento é o padrão.
 */
export async function isBotMuted(
  db: DbClient,
  conversationId: string | null | undefined,
): Promise<boolean> {
  if (!conversationId) return false;
  try {
    const { data } = await db.from("conversations")
      .select("bot_muted_at")
      .eq("id", conversationId)
      .maybeSingle();
    return Boolean(data?.bot_muted_at);
  } catch (e) {
    console.error("bot-mute: falha ao consultar, seguindo destravado:", e);
    return false;
  }
}

/**
 * Trava a partir do par (canal, contato externo) — a chave que o webhook tem em mãos
 * quando a mensagem chega, antes de resolver a conversa.
 *
 * Falha fechada como "não travado" pelo mesmo motivo de `isBotMuted`: erro de consulta não
 * pode emudecer o atendimento inteiro.
 */
export async function isBotMutedForContact(
  db: DbClient,
  channelId: string,
  externalContactId: string,
): Promise<boolean> {
  try {
    const { data: contact } = await db.from("contacts")
      .select("id")
      .eq("channel_id", channelId)
      .eq("external_contact_id", externalContactId)
      .maybeSingle();
    if (!contact) return false;
    const { data: conv } = await db.from("conversations")
      .select("bot_muted_at")
      .eq("contact_id", contact.id)
      .neq("status", "resolved")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return Boolean(conv?.bot_muted_at);
  } catch (e) {
    console.error("bot-mute: falha ao resolver contato, seguindo destravado:", e);
    return false;
  }
}

/**
 * Reconcilia o espelho local com o que o Chatwoot mostra AGORA.
 *
 * Nos dois sentidos de propósito: marcar quem ganhou a label é metade do trabalho — sem
 * limpar quem perdeu, remover a etiqueta não destravaria nada e a conversa ficaria muda
 * para sempre. Recebe a lista completa de conversas com a label (não um delta), então o
 * conjunto que está marcado no banco e não veio na lista é exatamente quem destravou.
 *
 * Devolve o que mudou, para o chamador decidir o efeito colateral — retomar o funil de
 * quem destravou, por exemplo.
 */
export async function reconcileBotMute(
  db: DbClient,
  mutedChatwootIds: number[],
  now = Date.now(),
): Promise<{ muted: string[]; unmuted: string[] }> {
  const cwIds = [...new Set(mutedChatwootIds.filter((n) => Number.isFinite(n)))];

  const [comLabel, marcadas] = await Promise.all([
    cwIds.length
      ? db.from("conversations")
        .select("id,bot_muted_at")
        .in("chatwoot_conversation_id", cwIds)
      : Promise.resolve({ data: [], error: null }),
    db.from("conversations")
      .select("id,chatwoot_conversation_id")
      .not("bot_muted_at", "is", null),
  ]);
  if (comLabel.error) throw comLabel.error;
  if (marcadas.error) throw marcadas.error;

  const paraMarcar = ((comLabel.data ?? []) as Record<string, unknown>[])
    .filter((r) => !r.bot_muted_at)
    .map((r) => String(r.id));
  const cwComLabel = new Set(cwIds);
  const paraLimpar = ((marcadas.data ?? []) as Record<string, unknown>[])
    .filter((r) => !cwComLabel.has(Number(r.chatwoot_conversation_id)))
    .map((r) => String(r.id));

  if (paraMarcar.length) {
    await db.from("conversations")
      .update({ bot_muted_at: new Date(now).toISOString() })
      .in("id", paraMarcar);
  }
  if (paraLimpar.length) {
    await db.from("conversations")
      .update({ bot_muted_at: null })
      .in("id", paraLimpar);
  }
  return { muted: paraMarcar, unmuted: paraLimpar };
}
