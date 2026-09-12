import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pumpRecoveryChain } from "../shared/recovery-chain.ts";

// 11–12/09: a recuperação saiu para 6 conversas com venda GANHA e 11 com venda perdida —
// gente que já tinha mandado CPF e pago no PIX recebeu "quer assistir aos vídeos?".
//
// A regra de pular won/lost sempre existiu (dueRecoveryVariation). O que falhou foi a
// ENTRADA dela: a consulta de desfechos mandava 500 ids numa URL de 18 KB, o proxy devolvia
// 414, o código lia só `data` e seguia com a lista vazia — todo mundo virava `open`.
//
// Por isso estes testes batem na borda, não na regra pura: erro de leitura tem que PARAR a
// rodada, e o desfecho lido tem que chegar até a decisão.

const dia = 86_400_000;
const now = Date.parse("2026-09-12T16:00:00Z");

type Opcoes = { outcome?: string; erroConversas?: boolean; erroSaidas?: boolean };

function banco({ outcome = "open", erroConversas = false, erroSaidas = false }: Opcoes) {
  const conversasPedidas: string[][] = [];
  const db = {
    from(table: string) {
      const filtros: Record<string, unknown> = {};
      let colunas = "";
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select(s: string) {
          colunas = s;
          return q;
        },
        eq(k: string, v: unknown) {
          filtros[k] = v;
          return q;
        },
        in(coluna: string, lote: string[]) {
          filtros.in = coluna;
          if (table === "conversations" && colunas === "id,outcome") {
            conversasPedidas.push(lote);
          }
          return q;
        },
        gte() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        not() {
          filtros.muted = true;
          return q;
        },
        maybeSingle() {
          filtros.single = true;
          return q;
        },
        then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) {
          let data: unknown = [];
          let error: unknown = null;
          if (table === "sales_sequences") {
            data = [{
              conversation_id: "c1",
              chatwoot_conversation_id: 787,
              last_sent_at: new Date(now - 5 * dia).toISOString(),
              status: "completed",
            }];
          }
          if (table === "conversations") {
            if (filtros.single) data = { id: "c1" };
            else if (filtros.muted) data = [];
            else {
              data = [{ id: "c1", outcome }];
              if (erroConversas) {
                data = null;
                error = { message: "414 Request-URI Too Large" };
              }
            }
          }
          if (table === "messages") {
            if (filtros.direction === "in") data = null; // o lead nunca respondeu
            else if (erroSaidas) {
              data = null;
              error = { message: "414 Request-URI Too Large" };
            }
          }
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return q;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { db, conversasPedidas };
}

Deno.test("venda ganha não recebe recuperação", async () => {
  let enviados = 0;
  const { db } = banco({ outcome: "won" });
  const r = await pumpRecoveryChain(db, () => {
    enviados++;
    return Promise.resolve(true);
  }, now);
  assertEquals(enviados, 0);
  assertEquals(r.due, 0);
});

Deno.test("venda perdida também não recebe", async () => {
  let enviados = 0;
  await pumpRecoveryChain(banco({ outcome: "lost" }).db, () => {
    enviados++;
    return Promise.resolve(true);
  }, now);
  assertEquals(enviados, 0);
});

Deno.test("conversa aberta continua recebendo", async () => {
  let enviados = 0;
  await pumpRecoveryChain(banco({ outcome: "open" }).db, () => {
    enviados++;
    return Promise.resolve(true);
  }, now);
  assertEquals(enviados, 1);
});

// A falha real: 414 na consulta de desfechos. Antes, isso virava "todo mundo é open".
Deno.test("erro ao ler desfechos PARA a rodada, não vira lista vazia", async () => {
  let enviados = 0;
  await assertRejects(() =>
    pumpRecoveryChain(banco({ outcome: "won", erroConversas: true }).db, () => {
      enviados++;
      return Promise.resolve(true);
    }, now)
  );
  assertEquals(enviados, 0, "nenhuma mensagem sai quando não dá pra saber quem já comprou");
});

Deno.test("erro ao ler quem está em atendimento também para a rodada", async () => {
  let enviados = 0;
  await assertRejects(() =>
    pumpRecoveryChain(banco({ erroSaidas: true }).db, () => {
      enviados++;
      return Promise.resolve(true);
    }, now)
  );
  assertEquals(enviados, 0);
});

Deno.test("os desfechos são consultados em lotes, nunca numa URL só", async () => {
  const { db, conversasPedidas } = banco({});
  await pumpRecoveryChain(db, () => Promise.resolve(true), now);
  assertEquals(conversasPedidas.length >= 1, true);
  for (const lote of conversasPedidas) {
    assertEquals(lote.length <= 40, true, "lote grande demais volta a estourar a URL");
  }
});
