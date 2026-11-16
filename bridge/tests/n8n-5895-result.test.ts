import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const code = await Deno.readTextFile(
  new URL("../../ops/n8n-5895-queue-result-2026-10-18.js", import.meta.url),
);
const run = (rows: Record<string, unknown>[]) =>
  new Function("$input", code)({
    all: () => rows.map((json) => ({ json })),
  }) as { json: Record<string, unknown> }[];

Deno.test("bloqueios conhecidos do 5895 não geram execução vermelha por minuto", () => {
  const result = run([
    { ok: true, sent: false, blocked: "nao-compra", cancelled: true },
    {
      ok: false,
      sent: false,
      blocked: "previous-step-not-sent",
      previous_status: "failed",
      in_progress: true,
    },
    {
      ok: false,
      sent: false,
      blocked: "previous-step-not-sent",
      previous_status: "failed",
      in_progress: false,
    },
  ])[0].json;
  assertEquals(result.cancelled, 1);
  assertEquals(result.waiting, 1);
  assertEquals(result.review, 1);
  assertEquals(result.blocked, 0);
});

Deno.test("falha técnica nova mantém a execução vermelha", () => {
  assertThrows(
    () => run([{ ok: false, error: "provider_unavailable" }]),
    Error,
    "provider_unavailable",
  );
});
