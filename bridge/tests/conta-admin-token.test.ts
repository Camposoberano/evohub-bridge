import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Multi-conta: cada conta Chatwoot tem o SEU administrador. Criar inbox exige role
// Administrator, e o token do env pertence à conta principal — mandá-lo para outra conta
// devolve 401 "Você não está autorizado a acessar esta conta".
//
// Foi o que travou o WhatsApp do David em 05/09. As inboxes de Facebook e Instagram dele
// nasceram às 22:18 e 22:22, quando CHATWOOT_ADMIN_TOKEN ainda não existia no ambiente e o
// código caía no token da própria conta. A env entrou no meio, e a tentativa das 22:39
// falhou. O sintoma parecia permissão do usuário; era herança de credencial.
//
// Réplica da regra de toCwAcct (accounts.ts) — a decisão de QUAL token administra a conta.
function adminTokenDaConta(
  tokenDaConta: string | undefined,
  adminTokenDoEnv: string | undefined,
): string | undefined {
  return tokenDaConta || adminTokenDoEnv;
}

// Réplica de adminHeaders (chatwoot.ts): quem de fato viaja no cabeçalho.
function tokenEnviado(admin: string | undefined, token: string): string {
  return admin ?? token;
}

Deno.test("conta com token próprio administra a si mesma", () => {
  const enviado = tokenEnviado(adminTokenDaConta("token-do-david", "admin-do-campo"), "token-do-david");
  assertEquals(
    enviado,
    "token-do-david",
    "o admin do env é de OUTRA conta — usá-lo aqui devolve 401 e a inbox nunca nasce",
  );
});

Deno.test("conta sem token próprio é a nossa instância e usa o admin do env", () => {
  const enviado = tokenEnviado(adminTokenDaConta(undefined, "admin-do-campo"), "token-do-env");
  assertEquals(enviado, "admin-do-campo", "criar inbox na conta principal exige o admin dela");
});

Deno.test("sem admin no env, sobra o token da própria conta", () => {
  // Estado anterior a 05/09: era assim que as inboxes do David conseguiam nascer.
  const enviado = tokenEnviado(adminTokenDaConta(undefined, undefined), "token-da-conta");
  assertEquals(enviado, "token-da-conta");
});

Deno.test("token vazio não vira admin silenciosamente", () => {
  const enviado = tokenEnviado(adminTokenDaConta("", "admin-do-campo"), "token-do-env");
  assertEquals(
    enviado,
    "admin-do-campo",
    "string vazia é ausência de token, não credencial — senão o cabeçalho sai em branco",
  );
});
