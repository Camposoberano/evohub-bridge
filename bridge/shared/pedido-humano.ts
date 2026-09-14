// pedido-humano — o cliente clicou "Falar com Cícero". Duas coisas têm que acontecer.
//
// Medido em 13/09: 8 clientes pediram falar com uma pessoa em 5 dias. **Nenhum tinha
// atendente designado**, e em duas conversas o funil continuou por cima do pedido — #2504
// recebeu mais 19 peças, #2578 mais 15. Duas dessas conversas fecharam venda mesmo sem
// ninguém responder; as outras seis seguiam abertas no dia seguinte.
//
// O botão existia desde sempre e só respondia "já te conectei com o Cícero, ele te chama em
// breve" — uma promessa que o sistema não cumpria e ninguém era avisado de que não cumpriu.
//
// Duas decisões que não são detalhe:
//
// 1. A pausa é SEM PRAZO. `autoPauseFunil` normal devolve a conversa ao funil em 2h, o que
//    aqui significa voltar a empilhar peça em cima de quem está esperando gente. Só um
//    atendente (ou o comando de retomada) tira dessa pausa.
// 2. O evento é o produto. Pausar sem avisar troca "cliente recebendo spam" por "cliente
//    esquecido em silêncio" — que foi o que aconteceu com os 8. O alerta é o que fecha o laço.
import type { DbClient } from "./supabase.ts";
import { claimDeliveryWithTtl } from "./supabase.ts";
import { autoPauseFunil } from "./funnel-state.ts";
import { descreveErro } from "./erros.ts";

/** Uma janela por conversa: clicar três vezes não vira três alertas. */
const JANELA_MS = 6 * 60 * 60_000;

export type OrigemPedido = "whatsapp" | "social" | "uazapi";

export type ResultadoPedidoHumano = {
  registrado: boolean;
  funilPausado: boolean;
  motivo?: "repetido" | "sem-conversa";
};

/**
 * Registra que esta conversa está esperando uma pessoa: para o funil e levanta o alerta.
 *
 * Nunca propaga erro. Isto roda no caminho do clique do cliente, e derrubar a resposta
 * ("já te conectei com o Cícero") por causa da instrumentação trocaria um problema por um
 * pior — o cliente ficaria sem resposta nenhuma.
 */
export async function registrarPedidoHumano(
  db: DbClient,
  opts: {
    conversationId: string | null;
    channelId: string | null;
    chatwootConversationId?: number | null;
    origem: OrigemPedido;
    contato?: string | null;
  },
): Promise<ResultadoPedidoHumano> {
  if (!opts.conversationId) return { registrado: false, funilPausado: false, motivo: "sem-conversa" };

  try {
    const novo = await claimDeliveryWithTtl(
      db,
      `pedido-humano-${opts.conversationId}`,
      "pedido-humano",
      JANELA_MS,
    );
    if (!novo) return { registrado: false, funilPausado: false, motivo: "repetido" };
  } catch (e) {
    // Sem saber se é repetido, seguir em frente: alerta a mais é melhor que cliente esquecido.
    console.error("pedido-humano: claim falhou, seguindo", descreveErro(e).slice(0, 140));
  }

  let funilPausado = false;
  try {
    funilPausado = await autoPauseFunil(
      opts.conversationId,
      "pediu-humano",
      { comPrazo: false },
    );
  } catch (e) {
    console.error("pedido-humano: pausa do funil falhou", descreveErro(e).slice(0, 160));
  }

  try {
    const { error } = await db.from("events").insert({
      source: "atendimento",
      event_type: "pediu_humano",
      channel_id: opts.channelId ?? null,
      payload: {
        conversation_id: opts.conversationId,
        chatwoot_conversation_id: opts.chatwootConversationId ?? null,
        origem: opts.origem,
        // só os 4 últimos: o alerta sai por WhatsApp e não precisa carregar o número inteiro
        contato: opts.contato ? `…${String(opts.contato).slice(-4)}` : null,
        funil_pausado: funilPausado,
      },
    });
    if (error) throw error;
  } catch (e) {
    console.error(
      "pedido-humano: evento falhou (cliente esperando SEM alerta)",
      descreveErro(e).slice(0, 160),
    );
    return { registrado: false, funilPausado };
  }

  console.log(
    "pedido-humano:",
    opts.chatwootConversationId ?? opts.conversationId,
    opts.origem,
    funilPausado ? "funil pausado" : "sem funil ativo",
  );
  return { registrado: true, funilPausado };
}
