// A trava comercial: quem já pagou e quem disse que não compra saem de toda cadeia
// automática. As etiquetas reais em produção (13/09) vêm em quatro grafias diferentes —
// `wa:Não COMPRA` (94), `wa:não compra` (33), `wa:Pago` (74) e `pago` (10) — então o teste
// usa as grafias de verdade, não versões limpas.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bloqueioDaConversa,
  bloqueioPorContato,
  bloqueiosPorConversa,
  motivoDoBloqueio,
} from "../shared/gate-comercial.ts";

Deno.test("outcome fechado bloqueia", () => {
  assertEquals(bloqueioDaConversa({ outcome: "won", labels: [] }), "won");
  assertEquals(bloqueioDaConversa({ outcome: "lost", labels: [] }), "lost");
});

Deno.test("open não bloqueia — é o estado de quem ainda está em jogo", () => {
  assertEquals(bloqueioDaConversa({ outcome: "open", labels: ["wa:fase 01"] }), null);
  assertEquals(bloqueioDaConversa({ outcome: "open", labels: [] }), null);
  assertEquals(bloqueioDaConversa({}), null);
});

Deno.test("etiqueta bloqueia mesmo antes do sync converter em outcome", () => {
  // o sync roda de 10 em 10 min; nessa janela o outcome ainda é "open"
  for (const etiqueta of ["wa:Não COMPRA", "wa:não compra", "nao-compra", "Não COMPRA"]) {
    assertEquals(
      bloqueioDaConversa({ outcome: "open", labels: [etiqueta] }),
      "lost",
      etiqueta,
    );
  }
  for (const etiqueta of ["wa:Pago", "pago", "Pago ", "pagamento-feito"]) {
    assertEquals(
      bloqueioDaConversa({ outcome: "open", labels: [etiqueta] }),
      "won",
      etiqueta,
    );
  }
});

Deno.test("venda ganha vence 'não compra' que sobrou de antes", () => {
  assertEquals(
    bloqueioDaConversa({ outcome: "open", labels: ["wa:não compra", "wa:Pago"] }),
    "won",
  );
});

Deno.test("etiqueta que não é comercial não bloqueia", () => {
  assertEquals(
    bloqueioDaConversa({
      outcome: "open",
      labels: ["SUL", "canal-oficial", "janela-aberta", "wa:fase 03", "lead-quente"],
    }),
    null,
  );
});

Deno.test("motivo vira rótulo curto para log e fila", () => {
  assertEquals(motivoDoBloqueio("won"), "ja-comprou");
  assertEquals(motivoDoBloqueio("lost"), "nao-compra");
});

// ---------------------------------------------------------------------------------------
// Consulta: erro NUNCA vira "ninguém comprou". Em 12/09 foi exatamente isso — a consulta
// estourou a URL, o código leu só `data`, a lista veio vazia e a recuperação saiu para 224
// conversas, 6 delas com venda ganha.
// ---------------------------------------------------------------------------------------

function dbConversas(linhas: Record<string, unknown>[], erro?: unknown) {
  return {
    from: () => ({
      select: () => ({
        in: (_col: string, lote: string[]) =>
          Promise.resolve(
            erro
              ? { data: null, error: erro }
              : { data: linhas.filter((l) => lote.includes(String(l.id))), error: null },
          ),
      }),
    }),
  } as never;
}

Deno.test("bloqueiosPorConversa separa quem está fora de quem está em jogo", async () => {
  const fora = await bloqueiosPorConversa(
    dbConversas([
      { id: "a", outcome: "open", labels: ["wa:Pago"] },
      { id: "b", outcome: "lost", labels: [] },
      { id: "c", outcome: "open", labels: ["SUL"] },
    ]),
    ["a", "b", "c"],
  );
  assertEquals(fora.get("a"), "won");
  assertEquals(fora.get("b"), "lost");
  assertEquals(fora.has("c"), false);
});

Deno.test("erro na consulta sobe em vez de virar lista vazia", async () => {
  await assertRejects(() =>
    bloqueiosPorConversa(dbConversas([], { code: "502", message: "Bad Gateway" }), ["a"])
  );
});

Deno.test("lista vazia não consulta nada", async () => {
  const fora = await bloqueiosPorConversa(dbConversas([], { message: "não deveria rodar" }), []);
  assertEquals(fora.size, 0);
});

// ---------------------------------------------------------------------------------------
// Pelo telefone: é assim que a campanha identifica o contato.
// ---------------------------------------------------------------------------------------

function dbContato(opts: {
  contato?: { id: string } | null;
  conversas?: Record<string, unknown>[];
  erroContato?: unknown;
  erroConversas?: unknown;
}) {
  return {
    from: (tabela: string) => ({
      select: () => {
        if (tabela === "contacts") {
          const alvo = {
            eq: () => alvo,
            maybeSingle: () =>
              Promise.resolve({
                data: opts.contato ?? null,
                error: opts.erroContato ?? null,
              }),
          };
          return alvo;
        }
        const alvo = {
          eq: () => alvo,
          order: () => alvo,
          limit: () =>
            Promise.resolve({
              data: opts.conversas ?? [],
              error: opts.erroConversas ?? null,
            }),
        };
        return alvo;
      },
    }),
  } as never;
}

Deno.test("contato sem cadastro não bloqueia", async () => {
  assertEquals(await bloqueioPorContato(dbContato({ contato: null }), "ch", "5511999"), null);
});

Deno.test("'pago' numa conversa JÁ RESOLVIDA continua bloqueando", async () => {
  // a venda fecha e a conversa é resolvida; a etiqueta fica lá. Olhar só a conversa aberta
  // deixaria o cliente que comprou receber isca de novo.
  const b = await bloqueioPorContato(
    dbContato({
      contato: { id: "k" },
      conversas: [
        { outcome: "open", labels: ["wa:fase 01"] },
        { outcome: "won", labels: ["wa:Pago"] },
      ],
    }),
    "ch",
    "5511999",
  );
  assertEquals(b, "won");
});

Deno.test("'não compra' em qualquer conversa do contato bloqueia", async () => {
  const b = await bloqueioPorContato(
    dbContato({
      contato: { id: "k" },
      conversas: [
        { outcome: "open", labels: [] },
        { outcome: "open", labels: ["wa:Não COMPRA"] },
      ],
    }),
    "ch",
    "5511999",
  );
  assertEquals(b, "lost");
});

Deno.test("contato só com conversa em aberto passa", async () => {
  const b = await bloqueioPorContato(
    dbContato({
      contato: { id: "k" },
      conversas: [{ outcome: "open", labels: ["SUL", "wa:fase 02"] }],
    }),
    "ch",
    "5511999",
  );
  assertEquals(b, null);
});

Deno.test("erro ao ler as conversas do contato sobe — campanha não manda no escuro", async () => {
  await assertRejects(() =>
    bloqueioPorContato(
      dbContato({ contato: { id: "k" }, erroConversas: { message: "timeout" } }),
      "ch",
      "5511999",
    )
  );
});
