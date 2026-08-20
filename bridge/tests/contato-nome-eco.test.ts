import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Reproduz a resolução de nome do parser do uazapi (handlers/uazapi-webhook.ts).
// Mantido aqui como espelho porque parseUazapiMessage não é exportado; o que importa é
// travar a REGRA, que é onde o defeito de produção nasceu.
function resolveNome(payload: {
  fromMe: boolean;
  senderName?: string;
  msgName?: string;
  chat?: { wa_name?: string; name?: string; lead_name?: string };
}): string | undefined {
  const first = (...vals: Array<unknown>) => {
    for (const v of vals) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  const c = payload.chat ?? {};
  return first(
    c.wa_name,
    c.name,
    c.lead_name,
    payload.fromMe ? undefined : payload.msgName,
    payload.fromMe ? undefined : payload.senderName,
  );
}

// O caso real, capturado do payload de produção em 20/08/2026: a mensagem que NÓS
// enviamos volta como eco com senderName = nome do nosso perfil, e o nome do produtor
// está em chat.wa_name. Usar senderName corrompeu 668 de 1024 contatos.
Deno.test("eco da nossa saida nao vira nome do contato", () => {
  const nome = resolveNome({
    fromMe: true,
    senderName: "Campo Soberano",
    chat: { wa_name: "Claudinei J Silva (CjS)" },
  });
  assertEquals(nome, "Claudinei J Silva (CjS)");
});

Deno.test("mensagem do lead usa o nome do lead", () => {
  assertEquals(
    resolveNome({ fromMe: false, senderName: "Ademir Lopes", chat: {} }),
    "Ademir Lopes",
  );
});

// Sem chat.wa_name e vindo de eco, é melhor devolver nada do que devolver o nosso nome —
// `inbound.ts` preserva o nome que já estava gravado quando recebe undefined.
Deno.test("eco sem nome do chat devolve nada, nunca o nosso nome", () => {
  assertEquals(
    resolveNome({ fromMe: true, senderName: "Campo Soberano", chat: {} }),
    undefined,
  );
});

// O chat manda nos dois sentidos: ele carrega o nome do OUTRO LADO, que é sempre o lead.
Deno.test("chat tem prioridade sobre senderName tambem na entrada", () => {
  assertEquals(
    resolveNome({
      fromMe: false,
      senderName: ".",
      chat: { wa_name: "Gilberto" },
    }),
    "Gilberto",
  );
});

// Espelha a guarda de shared/inbound.ts: eco não renomeia contato já existente.
function nomeAoAtualizar(
  msgOutgoing: boolean,
  msgName: string | undefined,
  nomeAtual: string,
): string {
  return (msgOutgoing ? null : msgName) || nomeAtual;
}

Deno.test("update por eco preserva o nome ja gravado", () => {
  assertEquals(
    nomeAoAtualizar(true, "Campo Soberano", "Claudinei J Silva"),
    "Claudinei J Silva",
  );
  assertEquals(
    nomeAoAtualizar(false, "Claudinei J Silva", "Campo Soberano"),
    "Claudinei J Silva",
  );
});
