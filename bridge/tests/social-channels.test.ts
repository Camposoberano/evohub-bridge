import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { listConversationMessages } from "../shared/chatwoot.ts";
import { releaseDelivery } from "../shared/supabase.ts";
import {
  commentReplyPath,
  parseSocialCommentChanges,
  withMetaCursor,
} from "../shared/social.ts";
import {
  matchSocialAutoReply,
  normalizeSocialText,
} from "../shared/social-autoreply.ts";

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

Deno.test("paginação Meta preserva filtros e acrescenta cursor", () => {
  assertEquals(
    withMetaCursor("123/comments?fields=id,text&limit=25", "cursor+/="),
    "123/comments?fields=id%2Ctext&limit=25&after=cursor%2B%2F%3D",
  );
});

Deno.test("falha de webhook libera delivery para retry", async () => {
  let released = "";
  const db = {
    from: () => ({
      delete: () => ({
        eq: (_column: string, value: string) => {
          released = value;
          return Promise.resolve({ error: null });
        },
      }),
    }),
  };
  await releaseDelivery(db as never, "hub-delivery-1");
  assertEquals(released, "hub-delivery-1");
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
  assertEquals(fb[0]?.from, "cmt-fb-person-1-fb-comment");
  assertEquals(fb[0]?.commentId, "fb-comment");
  assertEquals(fb[0]?.text, "Quero saber mais");

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
  assertEquals(ig[0]?.from, "cmt-ig-cliente-ig-comment");
  assertEquals(ig[0]?.commentId, "ig-comment");
  assertEquals(ig[0]?.text, "Preço?");
});

Deno.test("autorresposta social reconhece silagem e a variação cilagem", () => {
  const config = {
    rules: [{
      id: "silagem",
      enabled: true,
      channels: ["facebook", "instagram"] as ("facebook" | "instagram")[],
      keywords: ["silagem", "cilagem"],
      reply: "Resposta configurada",
    }],
  };
  assertEquals(normalizeSocialText("  SILÁGEM  "), "silagem");
  assertEquals(
    matchSocialAutoReply(config, "facebook", "fb-1", "Quero SILAGEM")?.id,
    "silagem",
  );
  assertEquals(
    matchSocialAutoReply(config, "instagram", "ig-1", "Preço da cilagem?")?.id,
    "silagem",
  );
  assertEquals(
    matchSocialAutoReply(config, "instagram", "ig-1", "Quero sementes"),
    null,
  );
});

Deno.test("autorresposta não dispara sem texto definitivo", () => {
  const config = {
    rules: [{
      id: "silagem",
      enabled: true,
      keywords: ["silagem"],
      reply: "",
    }],
  };
  assertEquals(
    matchSocialAutoReply(config, "facebook", "fb-1", "silagem"),
    null,
  );
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
