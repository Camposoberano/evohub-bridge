import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pumpRecoveryChain } from "../shared/recovery-chain.ts";
const day = 86400000;
const now = Date.parse("2026-09-11T16:00:00Z");
function database(inbound: number | null, variation = 1, readError = false) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let columns = "";
      const q: any = {
        select(s: string) { columns = s; return q; },
        eq(k: string, v: unknown) { filters[k] = v; return q; },
        in() { return q; }, gte() { return q; }, order() { return q; },
        limit() { return q; }, not() { filters.muted = true; return q; },
        maybeSingle() { filters.single = true; return q; },
        then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) {
          let data: unknown = [];
          let error: unknown = null;
          if (table === "sales_sequences") data = [{ conversation_id: "c1", chatwoot_conversation_id: 787, last_sent_at: new Date(now - 5 * day).toISOString(), status: "completed" }];
          if (table === "conversations" && !filters.muted) data = filters.single ? { id: "c1" } : [{ id: "c1", outcome: "open" }];
          if (table === "messages" && filters.direction === "in") data = inbound === null ? null : { sent_at: new Date(inbound).toISOString() };
          if (table === "events" && filters.event_type === "recovery_blocked") {
            data = [{ received_at: new Date(now - 3 * day).toISOString(), payload: { conversation_id: "c1", variation } }];
            if (readError) error = new Error("database unavailable");
          }
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return q;
    },
  } as any;
}
Deno.test("rodadas consecutivas nao despacham recuperacao bloqueada", async () => {
  let calls = 0;
  const db = database(now - 4 * day);
  for (let i = 0; i < 3; i++) {
    const result = await pumpRecoveryChain(db, () => { calls++; return Promise.resolve(false); }, now + i * 300000);
    assertEquals(result.due, 0);
  }
  assertEquals(calls, 0);
});
Deno.test("nova resposta libera bloqueio respeitando cadencia existente", async () => {
  let calls = 0;
  await pumpRecoveryChain(database(now - 2 * day), () => { calls++; return Promise.resolve(true); }, now);
  assertEquals(calls, 1);
});
Deno.test("bloqueio de outra variacao nao impede a recuperacao devida", async () => {
  let calls = 0;
  await pumpRecoveryChain(database(null, 2), () => { calls++; return Promise.resolve(true); }, now);
  assertEquals(calls, 1);
});
Deno.test("erro ao consultar bloqueios nao dispara tentativa", async () => {
  let calls = 0;
  await assertRejects(() => pumpRecoveryChain(database(null, 1, true), () => { calls++; return Promise.resolve(true); }, now));
  assertEquals(calls, 0);
});
