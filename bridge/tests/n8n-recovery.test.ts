import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { allRecoveryPiecesSent, recoveryVariation } from "../shared/n8n-recovery.ts";

Deno.test("reconhece apenas as quatro recuperações do funil restaurado", () => {
  assertEquals(recoveryVariation("mega-sorgo-5895-20260930:recuperacao-1"), 1);
  assertEquals(recoveryVariation("mega-sorgo-5895-20260930:recuperacao-4"), 4);
  assertEquals(recoveryVariation("mega-sorgo-5895-20260930:preco"), null);
  assertEquals(recoveryVariation("mega-sorgo-5895-v2:recuperacao-1"), null);
});

Deno.test("a cadeia só avança depois da última peça confirmada", () => {
  assertEquals(allRecoveryPiecesSent([]), false);
  assertEquals(allRecoveryPiecesSent([{ status: "sent" }, { status: "pending" }]), false);
  assertEquals(allRecoveryPiecesSent([{ status: "sent" }, { status: "failed" }]), false);
  assertEquals(allRecoveryPiecesSent([{ status: "sent" }, { status: "sent" }]), true);
});
