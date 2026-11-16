import { assertEquals } from "https://deno.land/std@0.224.0/assert/assert_equals.ts";
import {
  applyNoPurchaseLabels,
  reconcileNoPurchaseRemoval,
  shouldReleaseNoPurchaseBlock,
} from "../shared/commercial-outcome-labels.ts";
import type { DbClient } from "../shared/supabase.ts";

Deno.test("recusa preserva etiquetas do Chatwoot e aplica a etiqueta WhatsApp", async () => {
  let chatwoot: string[] = ["origem-anuncio"];
  const added: string[] = [];
  const ports = {
    getChatwoot: async () => chatwoot,
    setChatwoot: async (labels: string[]) => {
      chatwoot = labels;
    },
    getWhatsapp: async () => [{ id: "wa-label-1", name: "Não COMPRA" }],
    hasWhatsapp: async (id: string) => added.includes(id),
    addWhatsapp: async (id: string) => {
      added.push(id);
    },
  };
  const result = await applyNoPurchaseLabels(ports);
  assertEquals(result, { chatwoot: true, whatsapp: true, errors: [] });
  assertEquals(chatwoot, ["origem-anuncio", "nao-compra"]);
  assertEquals(added, ["wa-label-1"]);
  await applyNoPurchaseLabels(ports);
  assertEquals(chatwoot, ["origem-anuncio", "nao-compra"]);
  assertEquals(added, ["wa-label-1"]);
});

Deno.test("falha na etiqueta WhatsApp fica explícita e a etiqueta Chatwoot permanece", async () => {
  let chatwoot: string[] = [];
  const result = await applyNoPurchaseLabels({
    getChatwoot: async () => chatwoot,
    setChatwoot: async (labels) => {
      chatwoot = labels;
    },
    getWhatsapp: async () => [],
    addWhatsapp: async () => {
      throw new Error("não deveria tentar adicionar");
    },
  });
  assertEquals(result.chatwoot, true);
  assertEquals(result.whatsapp, false);
  assertEquals(result.errors.length, 1);
  assertEquals(chatwoot, ["nao-compra"]);
});

Deno.test("reativação requer remoção das duas etiquetas já confirmadas", () => {
  const attrs = {
    blocked_reason: "nao-compra",
    no_purchase_labels_confirmed_at: "2026-10-13T12:00:00Z",
  };
  assertEquals(shouldReleaseNoPurchaseBlock(attrs, [], [[]]), true);
  assertEquals(
    shouldReleaseNoPurchaseBlock(attrs, ["nao-compra"], [[]]),
    false,
  );
  assertEquals(
    shouldReleaseNoPurchaseBlock(attrs, [], [["wa:Não COMPRA"]]),
    false,
  );
  assertEquals(
    shouldReleaseNoPurchaseBlock({ blocked_reason: "nao-compra" }, [], [[]]),
    false,
  );
});

Deno.test("remoção confirmada libera novos atendimentos sem reabrir fila antiga", async () => {
  type Row = Record<string, unknown>;
  const rows: Record<string, Row[]> = {
    contacts: [{
      id: "contact",
      attributes: {
        blocked: true,
        blocked_reason: "nao-compra",
        blocked_at: "earlier",
        no_purchase_labels_confirmed_at: "earlier",
      },
    }],
    conversations: [{
      id: "conversation",
      contact_id: "contact",
      outcome: "lost",
      outcome_source: "explicit-reply",
      labels: [],
    }],
  };
  const from = (table: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let patch: Row | null = null;
    const query = {
      select: () => query,
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
      maybeSingle: async () => ({
        data: rows[table].find((row) => filters.every((f) => f(row))) ?? null,
        error: null,
      }),
      then: (resolve: (result: { data: Row[]; error: null }) => unknown) => {
        const matches = rows[table].filter((row) =>
          filters.every((f) => f(row))
        );
        if (patch) { for (const row of matches) Object.assign(row, patch); }
        return Promise.resolve(resolve({ data: matches, error: null }));
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
  assertEquals(
    await reconcileNoPurchaseRemoval(db, "contact", "conversation", []),
    false,
  );
  assertEquals((rows.contacts[0].attributes as Row).blocked, true);
  assertEquals(
    await reconcileNoPurchaseRemoval(db, "contact", "conversation", [], true),
    true,
  );
  assertEquals((rows.contacts[0].attributes as Row).blocked, undefined);
  assertEquals(rows.conversations[0].outcome, "open");
});
