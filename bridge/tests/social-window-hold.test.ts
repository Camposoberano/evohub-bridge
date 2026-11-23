import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  holdSocialWindowMessages,
  isN8nManagedFunnel,
  rebaseWindowHeldRows,
} from "../shared/social-window-hold.ts";

type Json = Record<string, unknown>;

/** Fake db: captura o padrão `like` do SELECT e conta os UPDATE que pausam peça. */
function fakeHoldDb(pendingRows: Json[]) {
  const likePatterns: string[] = [];
  let paused = 0;
  const db = {
    from(table: string) {
      if (table === "scheduled_messages") {
        return {
          select() {
            const chain = {
              eq() {
                return chain;
              },
              like(_column: string, pattern: string) {
                likePatterns.push(pattern);
                return chain;
              },
              limit() {
                return Promise.resolve({ data: pendingRows, error: null });
              },
            };
            return chain;
          },
          update() {
            return {
              eq() {
                return {
                  eq() {
                    paused++;
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    },
  };
  return { db, likePatterns, paused: () => paused };
}

Deno.test("o pump local não é dono de identidades n8n principais ou complementares", () => {
  assertEquals(isN8nManagedFunnel("mega-sorgo-5895-20260930"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-5895-20260930:preco"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-social-20260930"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-social-20260930:recuperacao-2"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo"), false);
});

Deno.test("hold por janela filtra pelo prefixo do funil (7d x social n8n)", async () => {
  const rows: Json[] = [{ id: "p1", payload: {} }, { id: "p2", payload: {} }];

  // 7d: segura só as peças do 7d.
  const sete = fakeHoldDb(rows);
  const held7d = await holdSocialWindowMessages(sete.db as never, "conv-ig", "mega-sorgo-7d-v1");
  assertEquals(sete.likePatterns, ["mega-sorgo-7d-v1%"]);
  assertEquals(held7d, 2);
  assertEquals(sete.paused(), 2);

  // Default (sem prefixo): mantém o funil social n8n antigo.
  const social = fakeHoldDb([{ id: "s1", payload: {} }]);
  const heldSocial = await holdSocialWindowMessages(social.db as never, "conv-fb");
  assertEquals(social.likePatterns, ["mega-sorgo-social-20260930%"]);
  assertEquals(heldSocial, 1);
});

Deno.test("isN8nManagedFunnel reconhece o 7d como gerenciado (hold social vale pra ele)", () => {
  assertEquals(isN8nManagedFunnel("mega-sorgo-7d-v1"), true);
  assertEquals(isN8nManagedFunnel("mega-sorgo-7d-v1:preco"), true);
});

Deno.test("a retomada preserva pausas e respeita o próximo horário comercial", () => {
  const now = Date.parse("2026-10-11T23:45:00.000Z"); // 20h45 BRT: já fora da janela (corte 19h55)
  const rows = rebaseWindowHeldRows([
    { id: "b", send_at: "2026-10-10T13:30:00.000Z" },
    { id: "a", send_at: "2026-10-10T13:00:00.000Z" },
  ], now);
  assertEquals(rows.map((row) => row.id), ["a", "b"]);
  assertEquals(rows[0].send_at, "2026-10-12T10:00:00.000Z"); // 07h BRT do dia seguinte
  assertEquals(rows[1].send_at, "2026-10-12T10:30:00.000Z");
});
