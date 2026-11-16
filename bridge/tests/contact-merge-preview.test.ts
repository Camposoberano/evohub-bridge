import { assessContactMerge } from "../shared/contact-merge-preview.ts";

const INBOX = 19;
const inbox = { inbox: { id: 19 }, source_id: "same-route" };
const base = {
  id: 101,
  name: "Nome Humano",
  phone_number: "+5511987654321",
  contact_inboxes: [inbox],
};
const mergee = {
  id: 102,
  name: "Cold-Log-665",
  phone_number: "+551187654321",
  contact_inboxes: [inbox],
};
const conversations = [
  { id: 401, inbox_id: 19, meta: { sender: { id: 101 } } },
];
const mergeeConversations = [
  { id: 402, inbox_id: 19, meta: { sender: { id: 102 } } },
];

function eq(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw Error(JSON.stringify({ actual, expected }));
  }
}

Deno.test("preview accepts one pair with the same routing identity", () => {
  eq(assessContactMerge(INBOX, base, mergee, [101, 102], conversations, mergeeConversations), []);
});

Deno.test("preview blocks differing route, third contact and other inbox", () => {
  eq(assessContactMerge(INBOX, base, {
    ...mergee,
    contact_inboxes: [{ inbox: { id: 19 }, source_id: "other-route" }],
  }, [101, 102], conversations, mergeeConversations).includes("routing_identity_differs"), true);
  eq(assessContactMerge(INBOX, base, mergee, [101, 102, 103], conversations, mergeeConversations).includes("candidate_set_ambiguous"), true);
  eq(assessContactMerge(INBOX, base, {
    ...mergee,
    contact_inboxes: [{ inbox: { id: 17 }, source_id: "same-route" }],
  }, [101, 102], conversations, mergeeConversations).includes("inbox_scope"), true);
});

Deno.test("preview blocks conflicting name, conversation and phone", () => {
  eq(assessContactMerge(INBOX, base, { ...mergee, name: "Outra Pessoa" }, [101, 102], conversations, mergeeConversations).includes("mergee_has_human_name"), true);
  eq(assessContactMerge(INBOX, base, mergee, [101, 102], conversations, [{ id: 402, inbox_id: 17 }]).includes("conversation_scope"), true);
  eq(assessContactMerge(INBOX, base, { ...mergee, phone_number: "+5511970000000" }, [101, 102], conversations, mergeeConversations).includes("phone_mismatch"), true);
});
