import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reconcileBotMute } from "../shared/bot-mute.ts";
import { rebasePausedSchedule } from "../shared/funnel-recovery.ts";

type Conv = {
  id: string;
  chatwoot_conversation_id: number;
  bot_muted_at: string | null;
};

// Fake mínimo no formato que reconcileBotMute usa: select(...).in(...) e
// select(...).not(...), mais update(...).in(...).
function fakeDb(rows: Conv[]) {
  const updates: Array<{ ids: string[]; value: string | null }> = [];
  const relation = {
    select(_cols: string) {
      return {
        in(_col: string, ids: (string | number)[]) {
          const wanted = new Set(ids.map(String));
          return Promise.resolve({
            data: rows.filter((r) =>
              wanted.has(String(r.chatwoot_conversation_id))
            ),
            error: null,
          });
        },
        not(_col: string, _op: string, _val: unknown) {
          return Promise.resolve({
            data: rows.filter((r) => r.bot_muted_at !== null),
            error: null,
          });
        },
      };
    },
    update(value: { bot_muted_at: string | null }) {
      return {
        in(_col: string, ids: string[]) {
          updates.push({ ids, value: value.bot_muted_at });
          for (const row of rows) {
            if (ids.includes(row.id)) row.bot_muted_at = value.bot_muted_at;
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db: { from: () => relation } as never, updates, rows };
}

const AGORA = Date.parse("2026-08-08T18:00:00.000Z");

Deno.test("conversa que ganhou a etiqueta passa a ficar travada", async () => {
  const s = fakeDb([
    { id: "a", chatwoot_conversation_id: 1, bot_muted_at: null },
    { id: "b", chatwoot_conversation_id: 2, bot_muted_at: null },
  ]);
  const r = await reconcileBotMute(s.db, [1], AGORA);
  assertEquals(r.muted, ["a"]);
  assertEquals(r.unmuted, []);
  assertEquals(s.rows[0].bot_muted_at, new Date(AGORA).toISOString());
  assertEquals(s.rows[1].bot_muted_at, null);
});

// A metade que faltaria se só marcássemos: sem limpar quem perdeu a etiqueta, tirar o
// `bot-off` no Chatwoot não destravaria nada e a conversa ficaria muda pra sempre.
Deno.test("conversa que perdeu a etiqueta destrava", async () => {
  const s = fakeDb([
    { id: "a", chatwoot_conversation_id: 1, bot_muted_at: "2026-08-07T10:00:00.000Z" },
  ]);
  const r = await reconcileBotMute(s.db, [], AGORA);
  assertEquals(r.muted, []);
  assertEquals(r.unmuted, ["a"]);
  assertEquals(s.rows[0].bot_muted_at, null);
});

// Idempotência: o loop roda de 20 em 20s. Quem já está travado e continua com a etiqueta
// não pode ser reescrito toda vez — isso apagaria o "travado desde quando".
Deno.test("tick repetido nao reescreve quem ja estava travado", async () => {
  const desde = "2026-08-07T10:00:00.000Z";
  const s = fakeDb([
    { id: "a", chatwoot_conversation_id: 1, bot_muted_at: desde },
  ]);
  const r = await reconcileBotMute(s.db, [1], AGORA);
  assertEquals(r.muted, []);
  assertEquals(r.unmuted, []);
  assertEquals(s.updates.length, 0);
  assertEquals(s.rows[0].bot_muted_at, desde);
});

// O defeito que o resume manual tinha: devolver as peças pra 'pending' sem mexer no
// send_at. Como elas ficaram no passado enquanto o funil esteve parado, o pump considera
// todas vencidas e despeja o roteiro restante no cliente de uma vez.
Deno.test("retomada nao devolve mensagem com send_at no passado", () => {
  const pausadasHaDias = [
    "2026-07-20T13:00:00.000Z",
    "2026-07-20T13:30:00.000Z",
    "2026-07-21T13:00:00.000Z",
  ];
  const reancorado = rebasePausedSchedule(pausadasHaDias, AGORA + 60_000);
  for (const at of reancorado) {
    if (Date.parse(at) <= AGORA) {
      throw new Error(`send_at no passado apos retomada: ${at}`);
    }
  }
  // e os intervalos originais seguem de pé: 30min e depois 24h
  assertEquals(
    Date.parse(reancorado[1]) - Date.parse(reancorado[0]),
    30 * 60_000,
  );
  assertEquals(
    Date.parse(reancorado[2]) - Date.parse(reancorado[1]),
    23.5 * 60 * 60_000,
  );
});
