import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dispatchRecovery } from "../handlers/funil-control.ts";

function database(eventError: unknown = null) {
  const events: Record<string, unknown>[] = [];
  return {
    events,
    db: {
      from(table: string) {
        if (table === "deliveries") {
          return {
            insert() {
              return Promise.resolve({ error: { code: "23505" } });
            },
          };
        }
        if (table === "events") {
          return {
            insert(event: Record<string, unknown>) {
              events.push(event);
              return Promise.resolve({ error: eventError });
            },
          };
        }
        const row = table === "channels"
          ? { id: "channel-1", type: "whatsapp" }
          : { external_contact_id: "5511999999999" };
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: row, error: null });
          },
        };
        return query;
      },
    } as any,
  };
}

Deno.test("recuperação automática reconcilia entrega histórica sem nota", async () => {
  const { db, events } = database();
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (...args) => {
    fetchCalls++;
    return originalFetch(...args);
  };
  try {
    const result = await dispatchRecovery(
      db,
      { id: "1342", channel_id: "channel-1", contact_id: "contact-1" },
      1342,
      1,
      {} as any,
      { automatic: true },
    );

    assertEquals(result, { state: "reconciled" });
    assertEquals(fetchCalls, 0, "reconciliação automática não publica nota no Chatwoot");
    assertEquals(events, [{
      source: "recovery",
      event_type: "recovery_sent",
      payload: {
        conversation_id: "1342",
        chatwoot_conversation_id: 1342,
        variation: 1,
        channel: "WhatsApp",
        reconciled_from_delivery: true,
      },
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("falha ao gravar reconciliação não é tratada como entrega", async () => {
  const { db, events } = database(new Error("database unavailable"));
  const result = await dispatchRecovery(
    db,
    { id: "1342", channel_id: "channel-1", contact_id: "contact-1" },
    1342,
    1,
    {} as any,
    { automatic: true },
  );

  assertEquals(result, { state: "failed" });
  assertEquals(events.length, 1);
});
