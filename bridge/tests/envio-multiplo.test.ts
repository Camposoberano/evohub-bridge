import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  notaDeEnvioParcial,
  resumoDeEnvios,
} from "../shared/envio-multiplo.ts";

// O laço de anexos sobrescrevia `res` a cada volta e gravava só o ÚLTIMO resultado. Duas
// imagens, a primeira entregue e a segunda falhando, marcavam a mensagem inteira como
// "failed" e o atendente recebia nota de falha por mídia que chegou.

Deno.test("uma parte entregue já não é falha da mensagem", () => {
  const r = resumoDeEnvios([
    { ok: true, mediaUrl: "https://cdn/1.jpg" },
    { ok: false, mediaUrl: null },
  ]);
  assertEquals(r.status, "sent");
  assertEquals(r.parcial, true);
  assertEquals(r.entregues, 1);
  assertEquals(r.falhados, 1);
});

Deno.test("nada entregue continua sendo falha", () => {
  const r = resumoDeEnvios([{ ok: false }, { ok: false }]);
  assertEquals(r.status, "failed");
  assertEquals(r.parcial, false);
  assertEquals(r.mediaUrl, null);
});

Deno.test("tudo entregue não é parcial", () => {
  const r = resumoDeEnvios([
    { ok: true, mediaUrl: "https://cdn/1.jpg" },
    { ok: true, mediaUrl: "https://cdn/2.jpg" },
  ]);
  assertEquals(r.status, "sent");
  assertEquals(r.parcial, false);
});

// media_url passa a guardar a PRIMEIRA mídia entregue, não a última tentada — antes, se a
// última falhava, a linha ficava apontando para uma mídia que nunca chegou.
Deno.test("media_url é a primeira entregue, não a última tentada", () => {
  const r = resumoDeEnvios([
    { ok: false, mediaUrl: null },
    { ok: true, mediaUrl: "https://cdn/entregue.jpg" },
    { ok: false, mediaUrl: null },
  ]);
  assertEquals(r.mediaUrl, "https://cdn/entregue.jpg");
});

Deno.test("nota parcial diz o que reenviar e avisa para não repetir tudo", () => {
  const nota = notaDeEnvioParcial(resumoDeEnvios([
    { ok: true, mediaUrl: "x" },
    { ok: true, mediaUrl: "y" },
    { ok: false },
  ]));
  assertEquals(nota.includes("2 de 3"), true);
  assertEquals(nota.includes("duplicado"), true);
});
