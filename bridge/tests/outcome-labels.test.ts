import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canonize,
  deriveOutcome,
  mergeLabels,
  splitByOrigin,
  WA_PREFIX,
} from "../shared/outcome-labels.ts";

// Grafias reais coletadas em produção: Chatwoot usa hífen, WhatsApp usa espaço,
// acento e maiúsculas variadas — e a instância 5895 tem "Pago " com espaço no fim.
Deno.test("canonize iguala as grafias das duas origens", () => {
  assertEquals(canonize("Não COMPRA"), "nao compra");
  assertEquals(canonize("não compra"), "nao compra");
  assertEquals(canonize("nao-compra"), "nao compra");
  assertEquals(canonize("Pago "), "pago");
  assertEquals(canonize("pago"), "pago");
  assertEquals(canonize("pagamento-feito"), "pagamento feito");
});

Deno.test("deriveOutcome reconhece venda em qualquer grafia", () => {
  assertEquals(deriveOutcome(["Pago "]), "won");
  assertEquals(deriveOutcome(["pagamento-feito"]), "won");
  assertEquals(deriveOutcome([`${WA_PREFIX}Pago`]), "won");
});

Deno.test("deriveOutcome reconhece perda em qualquer grafia", () => {
  assertEquals(deriveOutcome(["Não COMPRA"]), "lost");
  assertEquals(deriveOutcome(["nao-compra"]), "lost");
  assertEquals(deriveOutcome([`${WA_PREFIX}não compra`]), "lost");
});

Deno.test("won vence lost quando as duas estao presentes", () => {
  assertEquals(deriveOutcome(["nao-compra", "pago"]), "won");
  assertEquals(deriveOutcome([`${WA_PREFIX}Não COMPRA`, "pago"]), "won");
});

Deno.test("etiqueta sem significado comercial nao define desfecho", () => {
  assertEquals(deriveOutcome(["canal-oficial", "janela-fechada"]), null);
  assertEquals(deriveOutcome([`${WA_PREFIX}Fase 01`, `${WA_PREFIX}Sul`]), null);
  assertEquals(deriveOutcome([]), null);
});

Deno.test("splitByOrigin separa por prefixo para cada sync mexer so no seu", () => {
  const r = splitByOrigin(["canal-oficial", "wa:Pago", "pago", "wa:Fase 01"]);
  assertEquals(r.chatwoot, ["canal-oficial", "pago"]);
  assertEquals(r.whatsapp, ["wa:Pago", "wa:Fase 01"]);
});

Deno.test("mergeLabels nao duplica e mantem ordem estavel", () => {
  assertEquals(mergeLabels(["b", "a"], ["a", "c"]), ["a", "b", "c"]);
  assertEquals(mergeLabels([], []), []);
});
