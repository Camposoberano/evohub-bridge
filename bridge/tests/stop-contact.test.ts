import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.224.0/assert/assert_rejects.ts";
import {
  excludePaidContact,
  stopContactAutomation,
} from "../shared/stop-contact.ts";
import type { DbClient } from "../shared/supabase.ts";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function fakeDb(failCampaign = false): { db: DbClient; tables: Tables } {
  const tables: Tables = {
    contacts: [{
      id: "contact",
      channel_id: "channel",
      external_contact_id: "5511999999999",
      attributes: {},
    }],
    conversations: [
      { id: "one", contact_id: "contact", outcome: "open" },
      { id: "two", contact_id: "contact", outcome: "open" },
    ],
    scheduled_messages: [
      { id: "step1", conversation_id: "one", status: "pending" },
      { id: "step2", conversation_id: "two", status: "paused" },
      { id: "step3", conversation_id: "two", status: "sent" },
    ],
    sales_sequences: [
      { id: "seq1", conversation_id: "one", status: "running" },
      { id: "seq2", conversation_id: "two", status: "paused" },
    ],
    campaign_queue: [
      { id: "campaign1", contact_key: "5511999999999", status: "pending" },
      { id: "campaign2", contact_key: "5511999999999", status: "processing" },
      { id: "campaign3", contact_key: "5511999999999", status: "paused" },
      { id: "campaign4", contact_key: "5511999999999", status: "sent" },
    ],
    events: [],
  };
  const from = (table: string) => {
    let filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    let selected = false;
    const query = {
      select: (_columns: string, _opts?: unknown) => {
        selected = true;
        return query;
      },
      eq: (key: string, value: unknown) => {
        filters.push((row) => row[key] === value);
        return query;
      },
      neq: (key: string, value: unknown) => {
        filters.push((row) => row[key] !== value);
        return query;
      },
      in: (key: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[key]));
        return query;
      },
      update: (value: Row) => {
        patch = value;
        return query;
      },
      insert: (value: Row) => {
        tables[table].push(value);
        return Promise.resolve({ data: [value], error: null });
      },
      maybeSingle: async () => {
        const result = await query;
        return { data: result.data[0] ?? null, error: null };
      },
      then: (
        resolve: (
          value: { data: Row[]; count: number; error: null },
        ) => unknown,
      ) => {
        if (table === "campaign_queue" && failCampaign) {
          return Promise.resolve(
            resolve(
              {
                data: [],
                count: 0,
                error: new Error("database unavailable"),
              } as never,
            ),
          );
        }
        const data = tables[table].filter((row) =>
          filters.every((filter) => filter(row))
        );
        if (patch) { for (const row of data) Object.assign(row, patch); }
        return Promise.resolve(
          resolve({
            data: selected || !patch ? data : [],
            count: data.length,
            error: null,
          }),
        );
      },
    };
    return query;
  };
  const db = {
    from,
    schema: () => ({ from }),
    rpc: async () => ({}),
    auth: {},
    storage: {},
  } as unknown as DbClient;
  return { db, tables };
}

Deno.test("recusa exclui todas as conversas e campanhas sem alterar envios concluídos", async () => {
  const { db, tables } = fakeDb();
  const result = await stopContactAutomation(
    db,
    "channel",
    "5511999999999",
    "explicit-reply",
  );
  assertEquals(result.scheduled, 2);
  assertEquals(result.campaigns, 3);
  assertEquals((tables.contacts[0].attributes as Row).blocked, true);
  assertEquals(tables.conversations.map((row) => row.outcome), [
    "lost",
    "lost",
  ]);
  assertEquals(tables.scheduled_messages.map((row) => row.status), [
    "cancelled",
    "cancelled",
    "sent",
  ]);
  assertEquals(tables.campaign_queue.map((row) => row.status), [
    "skipped",
    "skipped",
    "skipped",
    "sent",
  ]);
  const repeated = await stopContactAutomation(
    db,
    "channel",
    "5511999999999",
    "explicit-reply",
  );
  assertEquals(repeated.scheduled, 0);
  assertEquals(repeated.campaigns, 0);
  assertEquals(tables.events.length, 1);
});

Deno.test("pago exclui campanhas sem marcar desinteresse", async () => {
  const { db, tables } = fakeDb();
  const result = await excludePaidContact(db, "channel", "5511999999999");
  assertEquals(result.campaigns, 3);
  assertEquals(
    (tables.contacts[0].attributes as Row).automation_excluded,
    true,
  );
  assertEquals((tables.contacts[0].attributes as Row).blocked, undefined);
  assertEquals(tables.conversations.map((row) => row.outcome), [
    "open",
    "open",
  ]);
});

Deno.test("falha na fila de campanha não é tratada como exclusão concluída", async () => {
  const { db } = fakeDb(true);
  await assertRejects(() =>
    stopContactAutomation(db, "channel", "5511999999999", "explicit-reply")
  );
});
