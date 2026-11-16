import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FASES, FIM_ACESSO } from "../handlers/funil-enroll.ts";

Deno.test("funil 5895 recupera as 31 etapas multimídia de 30/09", () => {
  const fases = FASES.map((fase) => fase());
  assertEquals(fases.map((fase) => fase.length), [7, 5, 5, 6, 8]);
  assertEquals(FIM_ACESSO, 560);
  assertEquals(fases.flat().length, 31);
  assertEquals(fases.flat().filter((p) => p.kind === "media" && p.mediaType === "audio").length, 10);
  assertEquals(fases.flat().filter((p) => p.kind === "media" && p.mediaType === "video").length, 4);
  assertEquals(fases[0].map((p) => p.kind), ["text", "media", "interactive", "media", "media", "media", "list"]);
  assertEquals(fases[4].map((p) => p.kind), ["interactive", "media", "media", "text_sequence", "media", "media", "interactive", "list"]);
});

Deno.test("texto, perguntas e botões da versão de 30/09", () => {
  const fases = FASES.map((fase) => fase());
  const phase2 = fases[1][0];
  const phase4 = fases[3][0];
  assertEquals(phase2.kind, "interactive");
  assertEquals(phase4.kind, "interactive");
  if (phase2.kind !== "interactive" || phase4.kind !== "interactive") return;
  assertStringIncludes(phase2.text, "140 toneladas de silagem por hectare ao ano");
  assertStringIncludes(phase4.text, "Resistente às pragas!");
  assertEquals(phase2.buttons.map((b) => b.id), ["f2_leite", "f2_corte", "f2_ambos"]);
  const final = fases[4][7];
  assertEquals(final.kind, "list");
  if (final.kind !== "list") return;
  assertEquals(final.sections[0].rows[0].id, "f5_local");
});
