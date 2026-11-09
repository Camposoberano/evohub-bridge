import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { enqueueSevenDayVideos } from "../shared/mega-sorgo-7d-videos.ts";
import { SEVEN_DAY_CONDITIONAL_VIDEOS, SEVEN_DAY_CONTENT } from "../shared/mega-sorgo-7d-content.ts";
import type { DbClient } from "../shared/supabase.ts";

type Row = Record<string, unknown>;

function videoDb(sequenceStatus = "running") {
  let inserted: Row[] = [];
  let insertCalls = 0;
  const media = Array.from({ length: 5 }, (_, i) => ({
    slot: `official_0${i + 1}`, url: `https://example.invalid/official_0${i + 1}.mp4`, type: "video",
  }));
  const db = {
    from(table: string) {
      const query = {
        select() { return this; },
        eq() { return this; },
        limit() { return this; },
        in() { return this; },
        maybeSingle() {
          return Promise.resolve({ data: table === "sales_sequences"
            ? { id: "sequence", status: sequenceStatus } : null, error: null });
        },
        then(resolve: (value: unknown) => void) {
          resolve({ data: table === "funnel_media" ? media : inserted.map((row) => ({ id: row.id })), error: null });
        },
        upsert(rows: Row[]) {
          insertCalls++;
          inserted = rows;
          return Promise.resolve({ error: null });
        },
      };
      return query;
    },
  } as unknown as DbClient;
  return { db, get inserted() { return inserted; }, get insertCalls() { return insertCalls; } };
}

Deno.test("vídeos oficiais entram uma vez, em ordem, após o aceite", async () => {
  assertEquals(SEVEN_DAY_CONTENT.some((piece) => piece.type === "video"), false);
  assertEquals(SEVEN_DAY_CONDITIONAL_VIDEOS.map((v) => v.payload.media_ref.slot),
    ["official_01", "official_02", "official_03", "official_04", "official_05"]);
  const fake = videoDb();
  const now = Date.parse("2026-11-09T13:00:00Z");
  assertEquals(fake.insertCalls, 0);
  assertEquals(await enqueueSevenDayVideos(fake.db, "conversation-test", 673, now), 5);
  assertEquals(fake.inserted.map((row) => (row.payload as Row).__funnel_piece_code),
    ["official_01", "official_02", "official_03", "official_04", "official_05"]);
  assertEquals(fake.inserted.map((row) => row.send_at), Array.from({ length: 5 }, (_, i) =>
    new Date(now + i * 5 * 60_000).toISOString()));
  assertEquals(await enqueueSevenDayVideos(fake.db, "conversation-test", 673, now), 0);
  assertEquals(fake.insertCalls, 1);
});

Deno.test("sequência pausada não enfileira vídeos", async () => {
  const fake = videoDb("paused");
  assertEquals(await enqueueSevenDayVideos(fake.db, "conversation-test", 673), 0);
  assertEquals(fake.insertCalls, 0);
});
