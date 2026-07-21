import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { claimDeliveryWithTtl } from "../shared/supabase.ts";

type Row = { delivery_id: string; source: string; received_at: string };

function fakeDb(initial?: Row) {
  let row = initial;
  const relation = {
    insert(value: Row) {
      if (row) return Promise.resolve({ error: { code: "23505" } });
      row = { ...value, received_at: new Date().toISOString() };
      return Promise.resolve({ error: null });
    },
    delete() {
      return {
        eq(_column: string, id: string) {
          return {
            lt(_dateColumn: string, cutoff: string) {
              if (row?.delivery_id === id && row.received_at < cutoff) {
                row = undefined;
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { db: { from: () => relation } as never, current: () => row };
}

Deno.test("trava outbound recente continua bloqueando duplicata", async () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = fakeDb({
    delivery_id: "same",
    source: "send-outbound",
    received_at: "2026-07-21T11:59:30.000Z",
  });
  assertEquals(
    await claimDeliveryWithTtl(state.db, "same", "send-outbound", 120_000, now),
    false,
  );
});

Deno.test("trava outbound antiga expira e permite novo envio", async () => {
  const now = new Date("2026-07-21T12:00:00.000Z");
  const state = fakeDb({
    delivery_id: "same",
    source: "send-outbound",
    received_at: "2026-07-21T11:57:59.000Z",
  });
  assertEquals(
    await claimDeliveryWithTtl(state.db, "same", "send-outbound", 120_000, now),
    true,
  );
});
