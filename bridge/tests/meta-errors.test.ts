import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isMetaWindowError,
  metaDeliveryStatus,
} from "../shared/meta-errors.ts";

Deno.test("classifica janela Meta encerrada como bloqueio terminal", () => {
  const data = {
    error: {
      code: 10,
      message: "Essa mensagem foi enviada fora do espaço de tempo permitido.",
    },
  };
  assertEquals(isMetaWindowError(400, data), true);
  assertEquals(metaDeliveryStatus(400, data), "blocked");
});

Deno.test("mantém outros erros Meta como falha recuperável", () => {
  assertEquals(
    metaDeliveryStatus(500, { error: { message: "temporary" } }),
    "failed",
  );
});
