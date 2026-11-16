import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FASES } from "../handlers/funil-enroll.ts";
import {
  isRestoredFunnelButton,
  restoredButtonAction,
} from "../shared/restored-funnel-buttons.ts";

Deno.test("todos os botões históricos têm uma ação", () => {
  const historical = FASES.flatMap((phase) => phase()).flatMap((piece) => {
    if (piece.kind === "interactive") {
      return piece.buttons.map((button) => button.id);
    }
    if (piece.kind === "list") {
      return piece.sections.flatMap((section) =>
        section.rows.map((row) => row.id)
      );
    }
    return [];
  }).filter((id) => id.startsWith("f"));
  assertEquals(new Set(historical).size, 16);
  for (const id of historical) {
    assertEquals(isRestoredFunnelButton(id), true, id);
  }
  assertEquals(restoredButtonAction("f5_sim"), {
    kind: "route",
    menuId: "menu_preco",
  });
  assertEquals(restoredButtonAction("menu_preco"), null);
});
