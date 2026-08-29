import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createConversationMessage,
  createIncomingMessage,
  listConversationMessages,
} from "../shared/chatwoot.ts";
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
import {
  isMetaWindowError,
  metaDeliveryStatus,
} from "../shared/meta-errors.ts";
import { windowState } from "../shared/window.ts";

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

Deno.test("envio ao Chatwoot tenta token admin quando agente não vê a inbox", async () => {
  const originalFetch = globalThis.fetch;
  const tokens: string[] = [];
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    tokens.push(headers.get("api_access_token") ?? "");
    if (tokens.length === 1) {
      return Promise.resolve(new Response('{"error":"unauthorized"}', { status: 401 }));
    }
    return Promise.resolve(Response.json({ id: 77 }));
  }) as typeof fetch;

  try {
    const message = await createConversationMessage(416, {
      content: "Boa tarde",
      messageType: "outgoing",
    }, {
      url: "https://chatwoot.example",
      accountId: "1",
      token: "agent-token",
      adminToken: "admin-token",
    });
    assertEquals(tokens, ["agent-token", "admin-token"]);
    assertEquals(message.id, 77);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("entrada usa API admin quando a rota pública antiga retorna 404", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((url: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push(`${String(url).includes("/public/") ? "public" : "app"}:${headers.get("api_access_token") ?? ""}`);
    if (calls.length === 1) return Promise.resolve(new Response("not found", { status: 404 }));
    if (calls.length === 2) return Promise.resolve(new Response("unauthorized", { status: 401 }));
    return Promise.resolve(Response.json({ id: 88 }));
  }) as typeof fetch;

  try {
    const message = await createIncomingMessage("inbox-id", "old-source", 416, "Resposta", {
      url: "https://chatwoot.example",
      accountId: "1",
      token: "agent-token",
      adminToken: "admin-token",
    });
    assertEquals(calls, ["public:", "app:agent-token", "app:admin-token"]);
    assertEquals(message.id, 88);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- janela Meta em canal social -------------------------------------------------
// 27-29/08: 47 saídas do Instagram viraram "falha genérica" porque o IG recusa com 403
// (subcode 2534022) e o classificador só olhava 400 + texto em inglês/português da Cloud API.

Deno.test("erro de janela do Instagram (403/2534022) conta como bloqueio", () => {
  const igError = {
    error: {
      message: "This message is sent outside of allowed window.",
      type: "IGApiException",
      code: 10,
      error_subcode: 2534022,
    },
  };
  assertEquals(isMetaWindowError(403, igError), true);
  assertEquals(metaDeliveryStatus(403, igError), "blocked");
});

Deno.test("variantes de texto da Meta em português contam como janela", () => {
  const espaco = {
    error: { code: 10, message: "(#10) Essa mensagem foi enviada fora do espaço de tempo permitido." },
  };
  const periodo = {
    error: { code: 10, message: "Essa mensagem foi enviada fora do período permitido." },
  };
  assertEquals(isMetaWindowError(400, espaco), true);
  assertEquals(isMetaWindowError(400, periodo), true);
});

Deno.test("falha que não é de janela continua sendo falha comum", () => {
  const expirado = {
    error: { code: 190, message: "Error validating access token: Session has expired" },
  };
  assertEquals(isMetaWindowError(401, expirado), false);
  assertEquals(metaDeliveryStatus(401, expirado), "failed");
  assertEquals(isMetaWindowError(403, { error: { code: 551, message: "Esta pessoa não está disponível." } }), false);
});

function dbComUltimaEntrada(sentAt: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({ data: sentAt ? { sent_at: sentAt } : null }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

Deno.test("Instagram sem phone_number_id tem janela de 24h, não 'sem-janela'", async () => {
  const ha25h = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const fechada = await windowState(
    dbComUltimaEntrada(ha25h) as never,
    { id: "conv-1" },
    { type: "instagram", phone_number_id: null },
  );
  assertEquals(fechada.tipo, "24h");
  assertEquals(fechada.aberta, false);

  const ha2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const aberta = await windowState(
    dbComUltimaEntrada(ha2h) as never,
    { id: "conv-2" },
    { type: "facebook", phone_number_id: null },
  );
  assertEquals(aberta.aberta, true);
});

Deno.test("canal não-oficial (uazapi/ryzeapi) continua sem janela", async () => {
  const win = await windowState(
    dbComUltimaEntrada(null) as never,
    { id: "conv-3" },
    { type: "whatsapp", phone_number_id: null },
  );
  assertEquals(win.tipo, "sem-janela");
  assertEquals(win.aberta, true);
});
