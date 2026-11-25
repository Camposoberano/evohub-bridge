import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  marcarProcessamentosAbandonados,
  marcarResultadoIncerto,
} from "../shared/campaign-queue.ts";
import type { DbClient } from "../shared/supabase.ts";

type Op = {
  kind: "select" | "update";
  values?: Record<string, unknown>;
  filters: Record<string, unknown>;
  lt: Record<string, unknown>;
};

/** Fake mínimo do PostgREST: registra cada operação e responde por uma função. */
function fakeDb(responder: (op: Op) => { data: unknown; error: unknown }) {
  const ops: Op[] = [];
  let rpcCalls = 0;
  const db = {
    schema: () => ({
      rpc: () => {
        rpcCalls++;
        return Promise.resolve({ data: true, error: null });
      },
      from: (table: string) => {
        assertEquals(table, "campaign_queue");
        const op: Op = { kind: "select", filters: {}, lt: {} };
        const builder = {
          select: () => builder,
          update: (values: Record<string, unknown>) => {
            op.kind = "update";
            op.values = values;
            return builder;
          },
          eq: (column: string, value: unknown) => {
            op.filters[column] = value;
            return builder;
          },
          lt: (column: string, value: unknown) => {
            op.lt[column] = value;
            return builder;
          },
          order: () => builder,
          limit: () => builder,
          then: (resolve: (value: unknown) => unknown) => {
            ops.push(op);
            return Promise.resolve(responder(op)).then(resolve);
          },
        };
        return builder;
      },
    }),
  } as unknown as DbClient;
  return { db, ops, rpcCalls: () => rpcCalls };
}

Deno.test("envio incerto fecha só o item e não pausa a campanha", async () => {
  const fake = fakeDb(() => ({ data: [{ id: "item-1" }], error: null }));
  await marcarResultadoIncerto(fake.db, "item-1", "timeout no provedor");

  assertEquals(fake.rpcCalls(), 0);
  assertEquals(fake.ops.length, 1);
  const [op] = fake.ops;
  assertEquals(op.kind, "update");
  assertEquals(op.filters, { id: "item-1", status: "processing" });
  assertEquals(op.values?.status, "failed");
  assertEquals(
    String(op.values?.last_error).startsWith("resultado de envio incerto: timeout"),
    true,
  );
  // nenhuma operação toca os outros contatos (status pending) da campanha
  assertEquals(fake.ops.some((o) => o.filters.status === "pending"), false);
});

Deno.test("envio incerto de item já enviado só anota para conferência", async () => {
  const fake = fakeDb((op) =>
    op.filters.status === "sent"
      ? { data: [{ id: "item-2" }], error: null }
      : { data: [], error: null }
  );
  await marcarResultadoIncerto(fake.db, "item-2", "erro depois do envio");

  assertEquals(fake.ops.map((o) => o.filters.status), ["processing", "sent"]);
  assertEquals(fake.ops[1].values?.status, undefined);
  assertEquals(fake.rpcCalls(), 0);
});

Deno.test("envio incerto de item que não está em processamento nem enviado é erro", async () => {
  const fake = fakeDb(() => ({ data: [], error: null }));
  await assertRejects(() => marcarResultadoIncerto(fake.db, "item-3", "x"));
});

Deno.test("worker interrompido fecha só os itens abandonados, sem pausar a campanha", async () => {
  const fake = fakeDb((op) =>
    op.kind === "select"
      ? {
        data: [
          { id: "a", campaign_id: "camp-1" },
          { id: "b", campaign_id: "camp-1" },
          { id: "c", campaign_id: "camp-2" },
        ],
        error: null,
      }
      // "c" foi retomado por outro worker entre o select e o update
      : { data: op.filters.id === "c" ? [] : [{ id: op.filters.id }], error: null }
  );
  const now = Date.parse("2026-11-25T12:00:00Z");
  const afetadas = await marcarProcessamentosAbandonados(fake.db, now);

  assertEquals(afetadas, ["camp-1"]);
  assertEquals(fake.rpcCalls(), 0);
  const updates = fake.ops.filter((o) => o.kind === "update");
  assertEquals(updates.map((o) => o.filters.id), ["a", "b", "c"]);
  for (const u of updates) {
    assertEquals(u.filters.status, "processing");
    assertEquals(u.values?.status, "failed");
    assertEquals(u.lt.updated_at, "2026-11-25T08:00:00.000Z");
  }
});
