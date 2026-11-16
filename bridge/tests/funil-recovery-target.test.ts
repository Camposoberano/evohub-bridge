import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recoverEligibleFunnels } from "../handlers/funil-enroll.ts";

function database() {
  const tablesRead: string[] = [];
  const conversation = {
    id: "conversation-1",
    channel_id: "channel-6836",
    contact_id: "contact-1",
    chatwoot_conversation_id: 6836,
    origem: "anuncio",
    status: "open",
    opened_at: new Date().toISOString(),
  };
  const db = {
    from(table: string) {
      tablesRead.push(table);
      const filters: Record<string, unknown> = {};
      // deno-lint-ignore no-explicit-any
      const q: any = {
        select() {
          return q;
        },
        eq(key: string, value: unknown) {
          filters[key] = value;
          return q;
        },
        neq(key: string, value: unknown) {
          filters[`neq:${key}`] = value;
          return q;
        },
        gte(key: string, value: unknown) {
          filters[`gte:${key}`] = value;
          return q;
        },
        in(key: string, values: unknown[]) {
          filters[`in:${key}`] = values;
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          filters.single = true;
          return q;
        },
        then(
          resolve: (result: unknown) => unknown,
          reject: (error: unknown) => unknown,
        ) {
          let data: unknown = [];
          if (table === "conversations") {
            data = filters.single ? conversation : [conversation];
          }
          if (table === "contacts") {
            data = [{ id: "contact-1", external_contact_id: "lead-1" }];
          }
          if (table === "channels") {
            data = [{ id: "channel-6836", name: "Campo Soberano 6836" }];
          }
          if (table === "messages") {
            data = [{
              conversation_id: "conversation-1",
              content: "Olá, quero mais informações",
              sent_at: new Date().toISOString(),
            }];
          }
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    // deno-lint-ignore no-explicit-any
  } as any;
  return { db, tablesRead };
}

Deno.test("recuperação não inscreve anúncios de canal diferente do 5895", async () => {
  const { db, tablesRead } = database();
  const result = await recoverEligibleFunnels(db, 48);
  assertEquals(result.scanned, 1);
  assertEquals(result.eligible, 0);
  assertEquals(result.enrolled, 0);
  assertEquals(tablesRead.includes("deliveries"), false);
});
