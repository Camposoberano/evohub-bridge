import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AI_LANE_LABEL,
  aiLaneEnabled,
  hasAiLaneLabel,
  withAiLaneLabel,
  withoutAiLaneLabel,
} from "../shared/ai-lane.ts";

Deno.test("hasAiLaneLabel reconhece a label da lane", () => {
  assert(hasAiLaneLabel([AI_LANE_LABEL]));
  assert(hasAiLaneLabel(["bot-off", AI_LANE_LABEL, "quente"]));
  assertEquals(hasAiLaneLabel([]), false);
  assertEquals(hasAiLaneLabel(["bot-off", "quente"]), false);
});

Deno.test("withAiLaneLabel adiciona sem duplicar e preserva as demais", () => {
  assertEquals(withAiLaneLabel([]), [AI_LANE_LABEL]);
  // não duplica
  assertEquals(withAiLaneLabel([AI_LANE_LABEL]), [AI_LANE_LABEL]);
  // preserva as outras labels (o Chatwoot só aceita substituir o conjunto inteiro)
  assertEquals(withAiLaneLabel(["bot-off", "quente"]), [
    "bot-off",
    "quente",
    AI_LANE_LABEL,
  ]);
});

Deno.test("withoutAiLaneLabel remove só a label da lane", () => {
  assertEquals(withoutAiLaneLabel([AI_LANE_LABEL]), []);
  assertEquals(withoutAiLaneLabel(["bot-off", AI_LANE_LABEL, "quente"]), [
    "bot-off",
    "quente",
  ]);
  // idempotente quando não está lá
  assertEquals(withoutAiLaneLabel(["bot-off"]), ["bot-off"]);
});

Deno.test("aiLaneEnabled lê a flag de deploy (default desligada)", () => {
  const original = Deno.env.get("AI_LANE_ENABLED");
  try {
    Deno.env.delete("AI_LANE_ENABLED");
    assertEquals(aiLaneEnabled(), false);
    Deno.env.set("AI_LANE_ENABLED", "0");
    assertEquals(aiLaneEnabled(), false);
    Deno.env.set("AI_LANE_ENABLED", "false");
    assertEquals(aiLaneEnabled(), false);
    Deno.env.set("AI_LANE_ENABLED", "1");
    assertEquals(aiLaneEnabled(), true);
    Deno.env.set("AI_LANE_ENABLED", "true");
    assertEquals(aiLaneEnabled(), true);
  } finally {
    if (original === undefined) Deno.env.delete("AI_LANE_ENABLED");
    else Deno.env.set("AI_LANE_ENABLED", original);
  }
});
