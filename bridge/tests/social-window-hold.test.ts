import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isN8nManagedFunnel,
  rebaseWindowHeldRows,
} from "../shared/social-window-hold.ts";

Deno.test("o pump local não é dono de identidades n8n principais ou complementares", () => {
  assertEquals(isN8nManagedFunnel("mega-sorgo-5895-20260930"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-5895-20260930:preco"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-social-20260930"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-social-20260930:recuperacao-2"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo"), false);
});

Deno.test("a retomada preserva pausas e respeita o próximo horário comercial", () => {
  const now = Date.parse("2026-10-11T23:45:00.000Z"); // 20h45 Fortaleza
  const rows = rebaseWindowHeldRows([
    { id: "b", send_at: "2026-10-10T13:30:00.000Z" },
    { id: "a", send_at: "2026-10-10T13:00:00.000Z" },
  ], now);
  assertEquals(rows.map((row) => row.id), ["a", "b"]);
  assertEquals(rows[0].send_at, "2026-10-11T23:45:15.000Z");
  assertEquals(rows[1].send_at, "2026-10-12T09:20:15.000Z"); // 06h20 Fortaleza
});
