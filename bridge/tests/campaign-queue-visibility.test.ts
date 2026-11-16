import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { campanhasComFila } from "../shared/campaign-queue.ts";
import type { DbClient } from "../shared/supabase.ts";

Deno.test("fila de botões 5895 continua visível depois das primeiras 1.000 linhas", async () => {
  const queries: Array<{ selected: string; filters: Record<string, unknown> }> = [];
  const db = {
    schema: (schema: string) => {
      assertEquals(schema, "public");
      return {
        from: (table: string) => {
          assertEquals(table, "campaign_queue");
          const query = { selected: "", filters: {} as Record<string, unknown> };
          queries.push(query);
          const builder = {
            select: (column: string) => {
              query.selected = column;
              return builder;
            },
            eq: (column: string, value: unknown) => {
              query.filters[column] = value;
              return builder;
            },
            lt: (column: string, value: unknown) => {
              query.filters[column] = value;
              return builder;
            },
            limit: () => builder,
            then: (resolve: (value: unknown) => unknown) =>
              Promise.resolve(query.selected === "campaign_id"
                ? { data: Array.from({ length: 1000 }, () => ({ campaign_id: "reativacao-5895-of" })), error: null }
                : { count: 1203, error: null }).then(resolve),
          };
          return builder;
        },
      };
    },
  } as unknown as DbClient;

  assertEquals(await campanhasComFila(db), ["reativacao-5895-of", "reativacao-5895-uz"]);
  assertEquals(queries.length, 2);
  assertEquals(queries[1].filters.campaign_id, "reativacao-5895-uz");
  assertEquals(queries[1].filters.status, "pending");
});
