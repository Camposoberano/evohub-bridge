import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { listConversationMessages } from "../shared/chatwoot.ts";
import {
  commentReplyPath,
  parseSocialCommentChanges,
} from "../shared/social.ts";

Deno.test("comentário usa a rota correta para cada plataforma", () => {
  assertEquals(
    commentReplyPath("cmt-fb-123", "comment-1"),
    "comment-1/comments",
  );
  assertEquals(
    commentReplyPath("cmt-ig-user", "comment-2"),
    "comment-2/replies",
  );
});

Deno.test("converte comentários de Facebook e Instagram em entradas", () => {
  const fb = parseSocialCommentChanges("page", {
    changes: [{
      field: "feed",
      value: {
        item: "comment",
        verb: "add",
        comment_id: "fb-comment",
        sender_id: "person-1",
        sender_name: "Maria",
        message: "Quero saber mais",
      },
    }],
  }, { page_id: "page-1" });
  assertEquals(fb[0]?.from, "cmt-fb-person-1");
  assertEquals(fb[0]?.commentId, "fb-comment");

  const ig = parseSocialCommentChanges("instagram", {
    changes: [{
      field: "comments",
      value: {
        id: "ig-comment",
        text: "Preço?",
        from: { id: "person-2", username: "cliente" },
      },
    }],
  }, { ig_id: "ig-1" });
  assertEquals(ig[0]?.from, "cmt-ig-cliente");
  assertEquals(ig[0]?.commentId, "ig-comment");
});

Deno.test("leitura do Chatwoot tenta token admin quando agente não vê a inbox", async () => {
  const originalFetch = globalThis.fetch;
  const tokens: string[] = [];
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    tokens.push(headers.get("api_access_token") ?? "");
    if (tokens.length === 1) {
      return Promise.resolve(
        new Response('{"error":"unauthorized"}', { status: 401 }),
      );
    }
    return Promise.resolve(Response.json({ payload: [{ id: 10 }] }));
  }) as typeof fetch;

  try {
    const messages = await listConversationMessages(99, {
      url: "https://chatwoot.example",
      accountId: "1",
      token: "agent-token",
      adminToken: "admin-token",
    });
    assertEquals(tokens, ["agent-token", "admin-token"]);
    assertEquals(messages, [{ id: 10 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
