import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { conversationItems, exactPhone, numberId } from "../handlers/customer-reconcile.ts";

Deno.test("accepts only exact positive IDs and complete phones", () => {
  assertEquals(numberId(21), 21);
  assertEquals(numberId("21"), 21);
  assertEquals(numberId("21x"), null);
  assertEquals(numberId(0), null);
  assertEquals(exactPhone("+55 88 99999-1234"), "+5588999991234");
  assertEquals(exactPhone("1234"), null);
  assertEquals(exactPhone("abc@lid"), null);
});

Deno.test("reads the Chatwoot list envelope without inventing a conversation", () => {
  assertEquals(conversationItems({ data: { payload: [{ id: 12 }, { id: 13 }] } })
    .map((item) => item.id), [12, 13]);
  assertEquals(conversationItems({ data: { payload: [] } }), []);
  assertEquals(conversationItems({ error: "rate_limited" }), []);
});
