import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePastedPhones } from "./phone-paste.mjs";

test("mantém telefones em linhas separadas sem concatenar", () => {
  assert.deepEqual(parsePastedPhones("5511888888888\n5588999999999"), [
    "5511888888888", "5588999999999",
  ]);
});

test("aceita vírgula, ponto e vírgula, espaço e telefone formatado", () => {
  assert.deepEqual(parsePastedPhones("5511888888888, 5588999999999; +55 (11) 98888-7777"), [
    "5511888888888", "5588999999999", "5511988887777",
  ]);
  assert.deepEqual(parsePastedPhones("5511888888888 5588999999999"), [
    "5511888888888", "5588999999999",
  ]);
});

test("remove repetidos sem inventar variante de telefone", () => {
  assert.deepEqual(parsePastedPhones("5511888888888\n5511888888888\n5511988888888"), [
    "5511888888888", "5511988888888",
  ]);
});
