import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle } from "../handlers/n8n-reconcile-5895.ts";

Deno.test("endpoint de reconciliação recusa método e credencial inválidos sem consultar o provedor", async () => {
  const original = Deno.env.get("N8N_ACTION_SECRET");
  Deno.env.set("N8N_ACTION_SECRET", "test-secret");
  try {
    const method = await handle(new Request("http://internal/n8n-reconcile-5895"));
    assertEquals(method.status, 405);
    const unauthorized = await handle(new Request("http://internal/n8n-reconcile-5895", {
      method: "POST",
      headers: { authorization: "Bearer wrong-secret" },
    }));
    assertEquals(unauthorized.status, 401);
  } finally {
    if (original === undefined) Deno.env.delete("N8N_ACTION_SECRET");
    else Deno.env.set("N8N_ACTION_SECRET", original);
  }
});
