import { redactSecrets } from "../shared/redact.ts";
import { isHybridRecipient } from "../shared/hybrid.ts";

Deno.test("redactSecrets removes nested webhook credentials", () => {
  const input = {
    token: "top-secret",
    BaseUrl: "https://example.invalid",
    data: {
      access_token: "nested-secret",
      message: "keep me",
      list: [{ apiKey: "secret" }, { id: 1 }],
    },
  };

  const clean = redactSecrets(input) as Record<string, unknown>;
  if (clean.token !== "[REDACTED]") {
    throw new Error("top-level token was not redacted");
  }
  const data = clean.data as Record<string, unknown>;
  if (data.access_token !== "[REDACTED]") {
    throw new Error("nested token was not redacted");
  }
  if (data.message !== "keep me") throw new Error("non-secret value changed");
  const list = data.list as Record<string, unknown>[];
  if (list[0].apiKey !== "[REDACTED]") {
    throw new Error("array secret was not redacted");
  }
});

Deno.test("hybrid route only accepts Brazilian phone recipients", () => {
  if (!isHybridRecipient("5511999999999")) {
    throw new Error("valid Brazilian phone was rejected");
  }
  if (isHybridRecipient("178894512345678")) {
    throw new Error("BSUID/LID must not be routed through Uazapi");
  }
  if (isHybridRecipient("cliente_usuario")) {
    throw new Error("username must not be routed through Uazapi");
  }
});
