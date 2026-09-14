import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { pumpRecoveryChain } from "../shared/recovery-chain.ts";
const day = 86400000;
const now = Date.parse("2026-09-11T16:00:00Z");
function database(inbound: number | null, variation = 1, readError = false) {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let columns = "";
      const q: any = {
        select(s: string) {
          columns = s;
          return q;
        },
        eq(k: string, v: unknown) {
          filters[k] = v;
          return q;
        },
        in() {
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
          filters.muted = true;
          return q;
        },
        maybeSingle() {
          filters.single = true;
          return q;
        },
        then(
          resolve: (r: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) {
          let data: unknown = [];
          let error: unknown = null;
          if (table === "sales_sequences") {
            data = [{
              conversation_id: "c1",
              chatwoot_conversation_id: 787,
              last_sent_at: new Date(now - 5 * day).toISOString(),
              status: "completed",
            }];
          }
          if (table === "conversations" && !filters.muted) {
            data = filters.single
              ? { id: "c1" }
              : [{ id: "c1", outcome: "open" }];
          }
          if (table === "messages" && filters.direction === "in") {
            data = inbound === null
              ? null
              : { sent_at: new Date(inbound).toISOString() };
          }
          if (table === "events" && filters.event_type === "recovery_blocked") {
            data = [{
              received_at: new Date(now - 3 * day).toISOString(),
              payload: { conversation_id: "c1", variation },
            }];
            if (readError) error = new Error("database unavailable");
          }
          return Promise.resolve({ data, error }).then(resolve, reject);
        },
      };
      return q;
    },
  } as any;
}

/** Banco mínimo para o caso 1342: a trava de `deliveries` já existe, mas o evento
 * `recovery_sent` expirou. O dispatcher simula a reconciliação gravando esse evento. */
function recoveryDatabase(conversationIds: string[]) {
  const reconciled = new Set<string>();
  const sequences = conversationIds.map((id, index) => ({
    conversation_id: id,
    chatwoot_conversation_id: 1342 + index,
    last_sent_at: new Date(now - 5 * day).toISOString(),
    status: "completed",
  }));
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const q: any = {
        select() {
          return q;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return q;
        },
        in() {
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
          filters.muted = true;
          return q;
        },
        maybeSingle() {
          filters.single = true;
          return q;
        },
        then(
          resolve: (r: unknown) => unknown,
          reject: (e: unknown) => unknown,
        ) {
          let data: unknown = [];
          if (table === "sales_sequences") data = sequences;
          if (table === "conversations") {
            if (filters.muted) data = [];
            else if (filters.single) {
              data = { id: filters.id };
            } else {
              data = conversationIds.map((id) => ({ id, outcome: "open" }));
            }
          }
          if (table === "messages") data = [];
          if (table === "events" && filters.event_type === "recovery_sent") {
            data = [...reconciled].map((id) => ({
              received_at: new Date(now).toISOString(),
              payload: { conversation_id: id, variation: 1 },
            }));
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  } as any;
  return { db, markReconciled: (id: string) => reconciled.add(id) };
}
Deno.test("rodadas consecutivas nao despacham recuperacao bloqueada", async () => {
  let calls = 0;
  const db = database(now - 4 * day);
  for (let i = 0; i < 3; i++) {
    const result = await pumpRecoveryChain(db, () => {
      calls++;
      return Promise.resolve({ state: "failed" as const });
    }, now + i * 300000);
    assertEquals(result.due, 0);
  }
  assertEquals(calls, 0);
});
Deno.test("nova resposta libera bloqueio respeitando cadencia existente", async () => {
  let calls = 0;
  await pumpRecoveryChain(database(now - 2 * day), () => {
    calls++;
    return Promise.resolve({ state: "sent" as const });
  }, now);
  assertEquals(calls, 1);
});
Deno.test("bloqueio de outra variacao nao impede a recuperacao devida", async () => {
  let calls = 0;
  await pumpRecoveryChain(database(null, 2), () => {
    calls++;
    return Promise.resolve({ state: "sent" as const });
  }, now);
  assertEquals(calls, 1);
});
Deno.test("erro ao consultar bloqueios nao dispara tentativa", async () => {
  let calls = 0;
  await assertRejects(() =>
    pumpRecoveryChain(database(null, 1, true), () => {
      calls++;
      return Promise.resolve({ state: "sent" as const });
    }, now)
  );
  assertEquals(calls, 0);
});

Deno.test("entrega historica sem recovery_sent e reconciliada uma vez, sem novo despacho", async () => {
  const { db, markReconciled } = recoveryDatabase(["1342"]);
  const calls: string[] = [];
  const dispatch = (conversation: Record<string, unknown>) => {
    const id = String(conversation.id);
    calls.push(id);
    markReconciled(id);
    // O contrato novo diferencia a entrega real da reconciliação da trava histórica.
    return Promise.resolve({ state: "reconciled" as const });
  };

  const first = await pumpRecoveryChain(db, dispatch, now, 1);
  assertEquals(first.sent, 0);
  assertEquals(first.reconciled, 1);
  assertEquals(calls, ["1342"]);

  await pumpRecoveryChain(db, dispatch, now + 300_000, 1);
  assertEquals(calls, ["1342"]);
});

Deno.test("reconciliacao historica nao consome maxPorRodada", async () => {
  const { db, markReconciled } = recoveryDatabase(["1342", "1343"]);
  const calls: string[] = [];
  const result = await pumpRecoveryChain(
    db,
    (conversation: Record<string, unknown>) => {
      const id = String(conversation.id);
      calls.push(id);
      if (id === "1342") {
        markReconciled(id);
        return Promise.resolve({ state: "reconciled" as const });
      }
      return Promise.resolve({ state: "sent" as const });
    },
    now,
    1,
  );

  assertEquals(calls, ["1342", "1343"]);
  assertEquals(result.sent, 1);
  assertEquals(result.reconciled, 1);
});
