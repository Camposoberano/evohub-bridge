import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { motivoTerminal } from "../handlers/funil-control.ts";

// O loop de macros só consome a etiqueta quando recebe ok:true ou terminal:true. Em qualquer
// outra resposta ele MANTÉM a etiqueta e tenta de novo a cada 15 segundos, para sempre.
//
// Em 08/09 havia seis conversas nesse estado — 24 tentativas por minuto, sem fim, cada uma
// repetindo uma falha que jamais mudaria sozinha. Estas são as mensagens reais colhidas do
// log daquele dia.

Deno.test("as cinco falhas reais do laço de 08/09 são terminais", () => {
  const reais = [
    "Error: template : canal sem phone_number_id (não-oficial)",
    "Error: janela-fechada",
    "Error: canal sem credenciais para enviar plantio",
    "conversa não encontrada",
    "canal ou contato não encontrado",
  ];
  for (const erro of reais) {
    const motivo = motivoTerminal(erro);
    assertEquals(typeof motivo, "string", `deveria ser terminal: ${erro}`);
    assertEquals((motivo ?? "").length > 20, true, "a nota precisa explicar, não só sinalizar");
  }
});

// A contrapartida importa tanto quanto: marcar como terminal o que era transitório faz a
// macro desistir de algo que funcionaria na tentativa seguinte.
Deno.test("falha transitória continua repetível", () => {
  for (const erro of [
    "Error: 502 Bad Gateway",
    "Error: request timeout",
    "TypeError: fetch failed",
    "Error: 500 Internal Server Error",
  ]) {
    assertEquals(motivoTerminal(erro), null, `não deveria ser terminal: ${erro}`);
  }
});

Deno.test("comentário público é terminal — funil não vale ali", () => {
  assertEquals(typeof motivoTerminal("blocked: comentario-publico"), "string");
});

Deno.test("string vazia não vira terminal por acidente", () => {
  assertEquals(motivoTerminal(""), null);
});

// A nota é escrita para o atendente, não para o log: precisa dizer o que fazer.
Deno.test("a nota de janela fechada diz o que destrava", () => {
  const motivo = motivoTerminal("Error: janela-fechada") ?? "";
  assertEquals(motivo.includes("cliente"), true, "quem reabre a janela é o cliente");
});

Deno.test("a nota de canal social explica a ausência de template", () => {
  const motivo = motivoTerminal("canal sem phone_number_id (não-oficial)") ?? "";
  assertEquals(motivo.includes("template"), true);
});
