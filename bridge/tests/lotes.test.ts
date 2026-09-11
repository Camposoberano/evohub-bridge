import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { consultaEmLotes, emLotes, LOTE_IDS } from "../shared/lotes.ts";

// 11/09: 500 uuids num `.in()` passavam de 18 KB de URL e o nginx do Supabase devolvia 414 a
// cada rodada do funnel-recovery. Estes testes prendem as duas regras do conserto.

const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

Deno.test("nenhum lote passa do tamanho e a URL fica bem abaixo de 8 KB", () => {
  const ids = Array.from({ length: 500 }, (_, i) => uuid(i));
  const lotes = emLotes(ids);
  assertEquals(lotes.length, 5);
  assertEquals(lotes.every((l) => l.length <= LOTE_IDS), true);
  assertEquals(lotes[0].join(",").length < 4_000, true);
});

Deno.test("consulta em lotes junta as linhas e ignora repetidos e vazios", async () => {
  const tamanhos: number[] = [];
  const ids = [...Array.from({ length: 250 }, (_, i) => uuid(i)), uuid(3), "", null];
  const linhas = await consultaEmLotes<{ id: string }>(ids, (lote) => {
    tamanhos.push(lote.length);
    return Promise.resolve({ data: lote.map((id) => ({ id })), error: null });
  });
  assertEquals(tamanhos, [100, 100, 50]);
  assertEquals(linhas.length, 250);
});

Deno.test("erro de lote sobe, nunca vira lista vazia", async () => {
  // lista vazia faria conversa já inscrita parecer elegível de novo
  await assertRejects(() =>
    consultaEmLotes([uuid(1)], () =>
      Promise.resolve({ data: null, error: { message: "414 Request-URI Too Large" } })
    )
  );
});

Deno.test("sem ids não vai ao banco", async () => {
  let chamadas = 0;
  const r = await consultaEmLotes([], () => {
    chamadas++;
    return Promise.resolve({ data: [], error: null });
  });
  assertEquals(r, []);
  assertEquals(chamadas, 0);
});
