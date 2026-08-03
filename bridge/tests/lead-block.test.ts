import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isContactBlocked } from "../shared/lead-block.ts";

Deno.test("contato sem attributes nao esta bloqueado", () => {
  assertEquals(isContactBlocked(null), false);
  assertEquals(isContactBlocked({}), false);
  assertEquals(isContactBlocked({ attributes: {} }), false);
});

Deno.test("contato com blocked=true esta bloqueado", () => {
  assertEquals(
    isContactBlocked({ attributes: { blocked: true, blocked_reason: "nao-compra" } }),
    true,
  );
});

Deno.test("blocked truthy nao-booleano nao conta (so true estrito)", () => {
  assertEquals(isContactBlocked({ attributes: { blocked: "sim" } }), false);
  assertEquals(isContactBlocked({ attributes: { blocked: 1 } }), false);
});

Deno.test("outras chaves de attributes nao confundem com blocked", () => {
  assertEquals(isContactBlocked({ attributes: { dead: true } }), false);
});
