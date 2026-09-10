// funil-pausa — pausa do funil COM PRAZO, e a retomada automática quando ele vence.
//
// Pedir preço é o maior sinal de compra que o lead dá, e até 10/09 era o que o tirava da
// sequência: `autoPauseFunil` era chamado para qualquer intenção comercial, a pausa não tinha
// prazo e nada a retomava. Em 10/09 havia 3.555 peças e 144 sequências paradas assim — mais
// de duzentas só naquele dia.
//
// O marcador vive em `deliveries` (delivery_id, source, received_at), que é tabela pequena e
// já existe. Foi escolha deliberada não criar coluna: a migration 0013 está encostada desde
// 30/08 por falta de SUPABASE_DB_URL, e um desenho que dependesse de schema novo nasceria
// bloqueado pelo mesmo motivo.
import type { DbClient } from "./supabase.ts";
import { optionalEnv } from "./env.ts";

const FONTE = "funil-pausa-preco";
const PREFIXO = "funil-pausa-";

/**
 * Horas até a retomada. Duas por padrão: tempo de o cliente reagir ao preço sem que a
 * conversa esfrie. Variável porque o número certo se descobre observando.
 */
export function horasDePausa(): number {
  const v = Number(optionalEnv("FUNIL_PAUSA_PRECO_HORAS") ?? "2");
  return Number.isFinite(v) && v > 0 ? v : 2;
}

/**
 * O lead está abrindo a conversa agora?
 *
 * Separa dois casos que pareciam um só. Quem chega perguntando o preço **na primeira
 * mensagem** veio do anúncio — o anúncio oferece essa pergunta pronta, e ela diz "me
 * interessei", não "já quero fechar". Esse precisa da apresentação antes do número, e o funil
 * não pode ser pausado: ele mal começou.
 *
 * Já quem pergunta o preço **depois** de receber a apresentação está avaliando a compra. Aí
 * o preço vai, e o funil espera a reação.
 *
 * 1 = a mensagem que acabou de ser gravada.
 */
export async function ehPrimeiraMensagem(
  db: DbClient,
  conversationId: string,
): Promise<boolean> {
  const { count, error } = await db.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId).eq("direction", "in");
  if (error) return false;
  return (count ?? 0) <= 1;
}

export function chaveDaPausa(conversationId: string): string {
  return `${PREFIXO}${conversationId}`;
}

/**
 * Registra que esta conversa tem funil pausado esperando retomada.
 *
 * Nunca propaga erro: marcar a pausa é instrumentação, e derrubar o envio do preço por causa
 * dela seria trocar um problema por outro pior. Sem o marcador, o comportamento é o de antes.
 */
export async function marcarPausa(
  db: DbClient,
  conversationId: string,
): Promise<void> {
  try {
    await db.from("deliveries").insert({
      delivery_id: chaveDaPausa(conversationId),
      source: FONTE,
    });
  } catch (e) {
    // conflito = já havia marcador; qualquer outro erro só é registrado
    const txt = String(e);
    if (!/duplicate|already exists|23505/i.test(txt)) {
      console.warn("funil-pausa: não consegui marcar", conversationId, txt.slice(0, 120));
    }
  }
}

/** Remove o marcador — venda fechada, stop manual, ou retomada concluída. */
export async function limparPausa(
  db: DbClient,
  conversationId: string,
): Promise<void> {
  try {
    await db.from("deliveries").delete().eq("delivery_id", chaveDaPausa(conversationId));
  } catch (e) {
    console.warn("funil-pausa: não consegui limpar", conversationId, String(e).slice(0, 120));
  }
}

/** Decide, sem banco, quais marcadores já passaram do prazo. Puro para poder ser testado. */
export function vencidas(
  marcadores: { delivery_id: string; received_at: string }[],
  agora: number,
  horas: number,
): string[] {
  const limite = horas * 3_600_000;
  return marcadores
    .filter((m) => {
      const t = Date.parse(m.received_at);
      // data ilegível não vence: melhor deixar parado do que retomar na hora errada
      return Number.isFinite(t) && agora - t >= limite;
    })
    .map((m) => m.delivery_id.slice(PREFIXO.length))
    .filter(Boolean);
}

/** Conversas cujo prazo de pausa já venceu. */
export async function pausasVencidas(
  db: DbClient,
  agora = Date.now(),
  horas = horasDePausa(),
): Promise<string[]> {
  const { data, error } = await db.from("deliveries")
    .select("delivery_id,received_at")
    .eq("source", FONTE)
    .limit(500);
  if (error) throw error;
  return vencidas(
    (data ?? []) as { delivery_id: string; received_at: string }[],
    agora,
    horas,
  );
}

/**
 * A conversa ainda merece receber o resto do funil?
 *
 * Retomar em cima de quem já comprou é pior que não retomar: a sequência de apresentação
 * chega para alguém que já é cliente. O mesmo vale para bot travado à mão.
 */
export function podeRetomar(
  conversa: { outcome?: string | null; bot_muted_at?: string | null } | null,
): boolean {
  if (!conversa) return false;
  if (conversa.bot_muted_at) return false;
  return conversa.outcome !== "won" && conversa.outcome !== "lost";
}
