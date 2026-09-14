// "Falar com Cícero": parar o funil e chamar gente.
//
// Em 13/09 foram 8 pedidos em 5 dias, nenhum com atendente designado, e em duas conversas o
// funil continuou por cima do pedido (19 e 15 peças). O botão só respondia "já te conectei
// com o Cícero" — promessa que ninguém cumpria porque ninguém era avisado.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { registrarPedidoHumano } from "../shared/pedido-humano.ts";

type Estado = {
  claimLivre: boolean;
  eventos: { event_type: string; payload: Record<string, unknown> }[];
  erroNoEvento?: boolean;
  erroNoClaim?: boolean;
};

// `autoPauseFunil` usa admin() por dentro e não recebe db: nestes testes não há sequência
// ativa, então ele devolve false e o que se prende aqui é o resto — claim, evento, payload.
function dbFalso(estado: Estado) {
  return {
    from: (tabela: string) => ({
      insert: (linha: { event_type?: string; payload?: Record<string, unknown> }) => {
        if (tabela === "deliveries") {
          if (estado.erroNoClaim) return Promise.resolve({ error: { message: "502" } });
          if (!estado.claimLivre) return Promise.resolve({ error: { code: "23505" } });
          estado.claimLivre = false;
          return Promise.resolve({ error: null });
        }
        if (estado.erroNoEvento) return Promise.resolve({ error: { message: "events fora" } });
        estado.eventos.push({
          event_type: String(linha.event_type),
          payload: linha.payload ?? {},
        });
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: () => ({ lt: () => Promise.resolve({ error: null }) }),
      }),
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  } as never;
}

Deno.test("sem conversa não registra nada", async () => {
  const estado: Estado = { claimLivre: true, eventos: [] };
  const r = await registrarPedidoHumano(dbFalso(estado), {
    conversationId: null,
    channelId: "ch",
    origem: "whatsapp",
  });
  assertEquals(r.registrado, false);
  assertEquals(r.motivo, "sem-conversa");
  assertEquals(estado.eventos.length, 0);
});

Deno.test("primeiro clique grava pediu_humano", async () => {
  const estado: Estado = { claimLivre: true, eventos: [] };
  const r = await registrarPedidoHumano(dbFalso(estado), {
    conversationId: "conv-1",
    channelId: "ch",
    chatwootConversationId: 2504,
    origem: "whatsapp",
    contato: "5519998887777",
  });
  assertEquals(r.registrado, true);
  assertEquals(estado.eventos.map((e) => e.event_type), ["pediu_humano"]);
  const p = estado.eventos[0].payload;
  assertEquals(p.chatwoot_conversation_id, 2504);
  assertEquals(p.origem, "whatsapp");
  // o alerta sai por WhatsApp: leva só o fim do número, não o número inteiro
  assertEquals(p.contato, "…7777");
});

Deno.test("clicar de novo na mesma janela não vira segundo alerta", async () => {
  const estado: Estado = { claimLivre: false, eventos: [] };
  const r = await registrarPedidoHumano(dbFalso(estado), {
    conversationId: "conv-1",
    channelId: "ch",
    origem: "whatsapp",
  });
  assertEquals(r.registrado, false);
  assertEquals(r.motivo, "repetido");
  assertEquals(estado.eventos.length, 0);
});

Deno.test("claim indisponível não engole o pedido — alerta a mais é melhor que cliente esquecido", async () => {
  const estado: Estado = { claimLivre: true, eventos: [], erroNoClaim: true };
  const r = await registrarPedidoHumano(dbFalso(estado), {
    conversationId: "conv-2",
    channelId: "ch",
    origem: "uazapi",
  });
  assertEquals(r.registrado, true);
  assertEquals(estado.eventos.map((e) => e.event_type), ["pediu_humano"]);
});

Deno.test("falha ao gravar o evento é reportada, não engolida", async () => {
  const estado: Estado = { claimLivre: true, eventos: [], erroNoEvento: true };
  const r = await registrarPedidoHumano(dbFalso(estado), {
    conversationId: "conv-3",
    channelId: "ch",
    origem: "social",
  });
  assertEquals(r.registrado, false);
  assertEquals(estado.eventos.length, 0);
});
