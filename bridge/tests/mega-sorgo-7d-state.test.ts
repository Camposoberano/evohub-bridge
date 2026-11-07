import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifySevenDayInbound, rebaseSevenDayPaused } from "../shared/mega-sorgo-7d-state.ts";

Deno.test("texto livre pausa, recusa encerra e clique segue o ramo", () => {
  assertEquals(classifySevenDayInbound({ content: "Qual o preço?" }), "pause");
  assertEquals(classifySevenDayInbound({ content: "Não quero receber mais" }), "optout");
  assertEquals(classifySevenDayInbound({ content: "sim", clickId: "video_7d_sim" }), "click");
  assertEquals(classifySevenDayInbound({ content: "Quero preço", clickId: "menu_preco" }), "pause");
  assertEquals(classifySevenDayInbound({ content: "Reservar", clickId: "f5_reservar" }), "pause");
  assertEquals(classifySevenDayInbound({ content: "[button]" }), "click");
  assertEquals(classifySevenDayInbound({ content: "Quero saber mais ✅" }), "click");
});

Deno.test("retomada reancora peças restantes em dias distintos sem disparar atraso", () => {
  const now = Date.parse("2026-11-07T22:30:00Z"); // sábado 19h30 em Fortaleza
  const rows = rebaseSevenDayPaused([
    { id: "d6", day: 6, step: 2 },
    { id: "d3b", day: 3, step: 1 },
    { id: "d3a", day: 3, step: 0 },
    { id: "d7", day: 7, step: 3 },
  ], now);
  assertEquals(rows.map((row) => row.id), ["d3a", "d3b", "d6", "d7"]);
  assertEquals(rows[0].send_at, "2026-11-07T22:35:00.000Z");
  assertEquals(rows[1].send_at, "2026-11-07T22:40:00.000Z");
  assertEquals(rows[2].send_at, "2026-11-07T22:45:00.000Z");
  assertEquals(rows[3].send_at, "2026-11-07T22:50:00.000Z");
});
