import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readConversationAssigneeUpdate } from "../shared/chatwoot-assignee.ts";

Deno.test("Chatwoot atribuição de usuário é associada à conversa e inbox", () => {
  assertEquals(
    readConversationAssigneeUpdate({
      id: 123,
      inbox_id: 7,
      meta: { assignee: { id: 42, type: "user" }, team: null },
    }),
    { conversationId: "123", inboxId: "7", assignee: "42" },
  );
});

Deno.test("atribuição só para equipe também bloqueia follow-up", () => {
  assertEquals(
    readConversationAssigneeUpdate({
      id: 123,
      inbox_id: 7,
      meta: { assignee: null, team: { id: 9 } },
    }),
    { conversationId: "123", inboxId: "7", assignee: "team:9" },
  );
});

Deno.test("desatribuição limpa a trava, payload sem meta.assignee não altera o estado", () => {
  assertEquals(
    readConversationAssigneeUpdate({
      id: 123,
      inbox_id: 7,
      meta: { assignee: null, team: null },
    }),
    { conversationId: "123", inboxId: "7", assignee: null },
  );
  assertEquals(readConversationAssigneeUpdate({ id: 123, inbox_id: 7, meta: {} }), null);
});
