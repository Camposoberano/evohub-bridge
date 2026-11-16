import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  clearMacroRequestId,
  currentMacroRequestId,
} from "../shared/macro-command-id.ts";
import type { DbClient } from "../shared/supabase.ts";

Deno.test("macro mantém ID durante retry e recebe novo ID após consumo", async () => {
  const rows = new Map<string, { received_at: string }>();
  let counter = 0;
  const db = {
    from(table: string) {
      assertEquals(table, "deliveries");
      return {
        async insert(row: { delivery_id: string }) {
          if (rows.has(row.delivery_id)) return { error: { code: "23505" } };
          rows.set(row.delivery_id, {
            received_at: new Date(1_760_000_000_000 + counter++ * 1000)
              .toISOString(),
          });
          return { error: null };
        },
        select() {
          return {
            eq(_column: string, id: string) {
              return {
                async maybeSingle() {
                  return { data: rows.get(id) ?? null, error: null };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq(_column: string, id: string) {
              rows.delete(id);
              return { error: null };
            },
          };
        },
      };
    },
  } as unknown as DbClient;
  const first = await currentMacroRequestId(db, 3509, "cmd-iniciar-funil");
  assertEquals(await currentMacroRequestId(db, 3509, "cmd-iniciar-funil"), first);
  await clearMacroRequestId(db, 3509, "cmd-iniciar-funil");
  assertEquals((await currentMacroRequestId(db, 3509, "cmd-iniciar-funil")) === first, false);
});
