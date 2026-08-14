import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type Flow,
  resolveNext,
  stepsUntilWait,
  validateFlow,
} from "../shared/flow.ts";

// Fluxo do jeito que a operação pediu: áudio, pergunta com botões, e caminho diferente
// conforme a resposta.
const FLUXO: Flow = {
  steps: [
    { id: "audio", kind: "media", media: { type: "audio", url: "https://x/a.ogg" } },
    {
      id: "pergunta",
      kind: "buttons",
      text: "Seu foco é leite ou corte?",
      buttons: [
        { id: "leite", title: "Leite" },
        { id: "corte", title: "Corte" },
      ],
      branches: { leite: "fala_leite", corte: "fala_corte" },
      fallbackNext: "humano",
      timeoutMin: 120,
      onTimeout: "lembrete",
    },
    { id: "fala_leite", kind: "text", text: "Pro leite o ganho é na proteína." },
    { id: "fala_corte", kind: "text", text: "Pro corte o ganho é no volume." },
    { id: "humano", kind: "text", text: "Vou te passar pro Cícero." },
    { id: "lembrete", kind: "text", text: "Ficou alguma dúvida?" },
  ],
};

Deno.test("manda ate a pergunta e para nela", () => {
  const r = stepsUntilWait(FLUXO, "audio");
  // a pergunta entra no envio: ela precisa sair para o lead ter o que responder
  assertEquals(r.enviar.map((s) => s.id), ["audio", "pergunta"]);
  assertEquals(r.pararEm?.id, "pergunta");
  assertEquals(r.fim, false);
});

Deno.test("resposta escolhe o caminho", () => {
  const pergunta = FLUXO.steps[1];
  assertEquals(resolveNext(pergunta, "leite"), "fala_leite");
  assertEquals(resolveNext(pergunta, "corte"), "fala_corte");
});

// O furo medido no funil: o cliente escreve 22× mais do que clica. Quem digita não pode
// ficar presa esperando um clique que não vem.
Deno.test("texto livre cai no fallback em vez de travar", () => {
  const pergunta = FLUXO.steps[1];
  assertEquals(resolveNext(pergunta, null), "humano");
  // botão desconhecido (id que não está em branches) também não pode travar
  assertEquals(resolveNext(pergunta, "id_que_nao_existe"), "humano");
});

// O bug do primeiro teste real (14/08): quem clicou "Sim" recebeu a resposta do "Sim", a do
// "Não" e o lembrete de timeout — três mensagens contraditórias juntas. `ok`, `ops` e
// `lembrete` não tinham `next`, então o motor caía de um no outro pela ordem da lista.
// Step que é destino de ramificação começa um RAMO: só se chega nele escolhendo.
Deno.test("ramo nao vaza para o ramo seguinte", () => {
  const r = stepsUntilWait(FLUXO, "fala_leite");
  assertEquals(r.enviar.map((s) => s.id), ["fala_leite"]);
  assertEquals(r.fim, true);

  const outro = stepsUntilWait(FLUXO, "fala_corte");
  assertEquals(outro.enviar.map((s) => s.id), ["fala_corte"]);

  // o destino do timeout também é ramo próprio
  const timeout = stepsUntilWait(FLUXO, "lembrete");
  assertEquals(timeout.enviar.map((s) => s.id), ["lembrete"]);
});

// Sequência normal (empilhar mensagens no editor) continua caindo de uma na outra: só o
// alvo de ramificação interrompe.
Deno.test("sequencia linear segue pela ordem da lista", () => {
  const linear: Flow = {
    steps: [
      { id: "a", kind: "text", text: "primeira" },
      { id: "b", kind: "text", text: "segunda" },
      { id: "c", kind: "text", text: "terceira" },
    ],
  };
  const r = stepsUntilWait(linear, "a");
  assertEquals(r.enviar.map((s) => s.id), ["a", "b", "c"]);
});

Deno.test("fluxo bem montado nao acusa problema", () => {
  assertEquals(validateFlow(FLUXO), []);
});

// O defeito grave: A→B→A sem pergunta no meio manda mensagem até a conta cair. Tem que ser
// recusado na hora de salvar, não descoberto pelo lead.
Deno.test("ciclo sem pergunta e recusado", () => {
  const ciclo: Flow = {
    steps: [
      { id: "a", kind: "text", text: "oi", next: "b" },
      { id: "b", kind: "text", text: "tudo bem?", next: "a" },
    ],
  };
  const problemas = validateFlow(ciclo);
  assertEquals(problemas.length > 0, true);
  assertEquals(problemas.some((p) => p.problema.includes("ciclo")), true);
});

// Mesmo com o validate, um fluxo antigo já salvo não pode virar rajada em produção.
Deno.test("runner nao repete step mesmo com ciclo salvo", () => {
  const ciclo: Flow = {
    steps: [
      { id: "a", kind: "text", text: "oi", next: "b" },
      { id: "b", kind: "text", text: "tudo bem?", next: "a" },
    ],
  };
  const r = stepsUntilWait(ciclo, "a");
  assertEquals(r.enviar.map((s) => s.id), ["a", "b"]);
  assertEquals(r.fim, true);
});

Deno.test("volta a la sem enviar mensagem repetida quando ha ciclo com pergunta", () => {
  const comPergunta: Flow = {
    steps: [
      { id: "a", kind: "text", text: "oi", next: "p" },
      {
        id: "p",
        kind: "buttons",
        text: "quer ver de novo?",
        buttons: [{ id: "sim", title: "Sim" }],
        branches: { sim: "a" },
        fallbackNext: "fim",
      },
      { id: "fim", kind: "end" },
    ],
  };
  // ciclo com pergunta no meio é legítimo: o lead escolhe repetir
  assertEquals(validateFlow(comPergunta), []);
});

Deno.test("acusa destino inexistente, botao demais e timeout sem saida", () => {
  const ruim: Flow = {
    steps: [
      { id: "a", kind: "text", text: "oi", next: "nao_existe" },
      {
        id: "b",
        kind: "buttons",
        text: "escolha",
        buttons: [
          { id: "1", title: "um" },
          { id: "2", title: "dois" },
          { id: "3", title: "tres" },
          { id: "4", title: "quatro" },
        ],
        timeoutMin: 60,
      },
    ],
  };
  const p = validateFlow(ruim);
  assertEquals(p.some((x) => x.problema.includes("não existe")), true);
  assertEquals(p.some((x) => x.problema.includes("o WhatsApp aceita 3")), true);
  assertEquals(p.some((x) => x.problema.includes("timeoutMin sem onTimeout")), true);
});
