import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ehNossoWebhook, tokenDoWebhook } from "../shared/webhook-url.ts";
import { alertasParaEntregar } from "../shared/operational-alert.ts";

const BASE = "https://cofre.camposoberano.com.br";

// Um número novo só responde a macro depois de três ligações: linha em `channels`, webhook
// da uazapi e webhook da inbox. O relatório de prontidão existe para dizer QUAL das três
// falta — e ele erra se não souber distinguir "não é nosso" de "é nosso, mas desatualizado".

Deno.test("webhook nosso é reconhecido por host+caminho, não pela URL inteira", () => {
  const comSegredoAtual = `${BASE}/uazapi-webhook?token=novo`;
  const comSegredoAntigo = `${BASE}/uazapi-webhook?token=antigo`;
  assertEquals(ehNossoWebhook(comSegredoAtual, "/uazapi-webhook", BASE), true);
  assertEquals(
    ehNossoWebhook(comSegredoAntigo, "/uazapi-webhook", BASE),
    true,
    "segredo velho continua sendo NOSSO webhook — senão o relatório manda criar um duplicado",
  );
});

Deno.test("webhook de terceiro e caminho errado não passam por nossos", () => {
  assertEquals(
    ehNossoWebhook("https://outro.servico.com/uazapi-webhook?token=x", "/uazapi-webhook", BASE),
    false,
    "mesmo caminho em outro host é de terceiro",
  );
  assertEquals(
    ehNossoWebhook(`${BASE}/hub-webhook?token=x`, "/uazapi-webhook", BASE),
    false,
    "nosso host, mas outro receptor",
  );
});

Deno.test("url ausente ou quebrada não derruba a verificação", () => {
  assertEquals(ehNossoWebhook(null, "/uazapi-webhook", BASE), false);
  assertEquals(ehNossoWebhook("", "/uazapi-webhook", BASE), false);
  assertEquals(ehNossoWebhook("nao é url", "/uazapi-webhook", BASE), false);
  assertEquals(tokenDoWebhook("nao é url"), null);
  assertEquals(tokenDoWebhook(undefined), null);
});

Deno.test("token é lido da query pra separar atual de desatualizado", () => {
  assertEquals(tokenDoWebhook(`${BASE}/uazapi-webhook?token=abc123`), "abc123");
  assertEquals(
    tokenDoWebhook(`${BASE}/uazapi-webhook`),
    null,
    "sem token na URL o webhook não autentica no bridge",
  );
});

// A instância órfã descartava a mensagem do cliente em silêncio. Só vira conserto se o
// alerta SAIR — e sair depende de estar na lista de entregáveis.
Deno.test("número recebendo sem canal cadastrado é alerta entregue, não aviso de rotina", () => {
  const entregues = alertasParaEntregar([
    { key: "canal_nao_cadastrado", severity: "critical", count: 1, detail: "novo-11922" },
    { key: "lead_missing_avatar_24h", severity: "warning", count: 21 },
  ]);
  assertEquals(entregues.length, 1);
  assertEquals(entregues[0].key, "canal_nao_cadastrado");
  assertEquals(
    entregues[0].detail,
    "novo-11922",
    "o nome da instância é o que permite cadastrar o canal — sem ele o alerta não é acionável",
  );
});

Deno.test("sem instância órfã, nada é entregue", () => {
  const entregues = alertasParaEntregar([
    { key: "canal_nao_cadastrado", severity: "critical", count: 0 },
  ]);
  assertEquals(entregues.length, 0);
});
