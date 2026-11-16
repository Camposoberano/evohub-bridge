import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { describeError } from "../shared/error-detail.ts";

Deno.test("describeError extrai a causa de um erro PostgREST (objeto plano)", () => {
  const pgError = {
    message: "canceling statement due to statement timeout",
    code: "57014",
    details: null,
    hint: "",
  };
  const out = describeError(pgError);
  // Causa real visível, não "[object Object]".
  assertEquals(out.includes("57014"), true);
  assertEquals(out.includes("statement timeout"), true);
  assertEquals(out.includes("[object Object]"), false);
});

Deno.test("describeError usa a mensagem de um Error nativo", () => {
  assertEquals(describeError(new Error("falha x")), "falha x");
});

Deno.test("describeError trata string e objeto sem campos conhecidos", () => {
  assertEquals(describeError("erro cru"), "erro cru");
  assertEquals(describeError({ foo: 1 }), '{"foo":1}');
});
