import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";

// Etapa 1 da rotação: o bridge aceita DOIS segredos ao mesmo tempo, para que as 10 inboxes
// do Chatwoot — configuradas fora deste repositório — possam migrar uma a uma sem derrubar
// o recebimento.

Deno.test("sem env de rotação, comportamento é o de sempre", () => {
  Deno.env.delete("CHATWOOT_WEBHOOK_SECRET_NOVO");
  assertEquals(confereSegredo("atual", ["atual"]), true);
  assertEquals(confereSegredo("outro", ["atual"]), false);
});

Deno.test("durante a rotação, os dois segredos valem", () => {
  Deno.env.set("CHATWOOT_WEBHOOK_SECRET_NOVO", "novo");
  try {
    assertEquals(confereSegredo("atual", ["atual"]), true, "o antigo segue valendo");
    assertEquals(confereSegredo("novo", ["atual"]), true, "o novo passa a valer");
    assertEquals(confereSegredo("terceiro", ["atual"]), false);
  } finally {
    Deno.env.delete("CHATWOOT_WEBHOOK_SECRET_NOVO");
  }
});

Deno.test("token vazio ou ausente nunca passa", () => {
  Deno.env.set("CHATWOOT_WEBHOOK_SECRET_NOVO", "novo");
  try {
    assertEquals(confereSegredo("", ["atual"]), false);
    assertEquals(confereSegredo(null, ["atual"]), false);
    assertEquals(confereSegredo(undefined, ["atual"]), false);
    // segredo esperado vazio não pode transformar tudo em válido
    assertEquals(confereSegredo("qualquer", [""]), false);
    assertEquals(confereSegredo("qualquer", [undefined]), false);
  } finally {
    Deno.env.delete("CHATWOOT_WEBHOOK_SECRET_NOVO");
  }
});

Deno.test("env de rotação em branco é ignorada", () => {
  Deno.env.set("CHATWOOT_WEBHOOK_SECRET_NOVO", "   ");
  try {
    assertEquals(confereSegredo("   ", ["atual"]), false);
    assertEquals(confereSegredo("atual", ["atual"]), true);
  } finally {
    Deno.env.delete("CHATWOOT_WEBHOOK_SECRET_NOVO");
  }
});
