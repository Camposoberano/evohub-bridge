import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveInboxIdentifier } from "../shared/chatwoot.ts";

Deno.test("resolveInboxIdentifier returns stored identifier without extra fetch", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ inbox_identifier: "fallback-id" }), {
        status: 200,
      }),
    );
  }) as typeof fetch;

  try {
    const resolved = await resolveInboxIdentifier("42", {
      url: "https://chatwoot.test",
      token: "token",
      accountId: "1",
    }, "stored-id");
    assertEquals(resolved, "stored-id");
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("resolveInboxIdentifier fetches identifier when missing", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls += 1;
    const url = input instanceof Request ? input.url : String(input);
    assertEquals(url, "https://chatwoot.test/api/v1/accounts/1/inboxes/42");
    return Promise.resolve(
      new Response(
        JSON.stringify({ channel: { inbox_identifier: "fetched-id" } }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;

  try {
    const resolved = await resolveInboxIdentifier("42", {
      url: "https://chatwoot.test",
      token: "token",
      accountId: "1",
    });
    assertEquals(resolved, "fetched-id");
    assertEquals(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
