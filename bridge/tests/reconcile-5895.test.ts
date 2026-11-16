import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  expireStale5895Uncertain,
  matchingReceipt,
  reconcilable5895Type,
  uniqueConfirmedReceipt,
} from "../shared/reconcile-5895.ts";

const at = Date.parse("2026-10-12T12:00:00Z");
const row = { type: "video", payload: { media_url: "https://example.test/video.mp4" } };
const receipt = {
  fromMe: true,
  messageTimestamp: at + 20_000,
  messageType: "videoMessage",
  sendPayload: { file: row.payload.media_url },
  status: "Delivered",
};

Deno.test("reconciliação aceita somente recibo confirmado da mesma mídia na janela da tentativa", () => {
  assertEquals(matchingReceipt(row, receipt, at), true);
  assertEquals(matchingReceipt(row, { ...receipt, status: "Sent" }, at), false);
  assertEquals(matchingReceipt(row, { ...receipt, fromMe: false }, at), false);
  assertEquals(matchingReceipt(row, { ...receipt, messageTimestamp: at + 181_000 }, at), false);
  assertEquals(matchingReceipt(row, { ...receipt, sendPayload: { file: "other" } }, at), false);
});

Deno.test("reconciliação exige texto exato para interação e aceita leitura", () => {
  const interaction = { type: "interactive", payload: { text: "Escolha" } };
  assertEquals(matchingReceipt(interaction, {
    fromMe: true, messageTimestamp: at, status: "Read",
    sendPayload: { text: "Escolha" },
  }, at), true);
  assertEquals(matchingReceipt(interaction, {
    fromMe: true, messageTimestamp: at, status: "Read",
    sendPayload: { text: "Outro" },
  }, at), false);
});

Deno.test("sem recibo único, a peça permanece sem confirmação", () => {
  assertEquals(uniqueConfirmedReceipt([]).error, "receipt_missing");
  assertEquals(uniqueConfirmedReceipt([receipt, receipt]).error, "receipt_ambiguous");
  assertEquals(uniqueConfirmedReceipt([receipt]).receipt, receipt);
});

Deno.test("reconciliação do vídeo assíncrono exige track_id da tentativa", () => {
  const tracked = {
    type: "video",
    payload: {
      media_url: row.payload.media_url,
      __funnel_delivery: { async_track_id: "funnel-attempt-1" },
    },
  };
  assertEquals(matchingReceipt(tracked, { ...receipt, track_id: "funnel-attempt-1" }, at), true);
  assertEquals(matchingReceipt(tracked, {
    ...receipt,
    track_id: "funnel-attempt-1",
    messageTimestamp: at + 10 * 60_000,
  }, at), true);
  assertEquals(matchingReceipt(tracked, receipt, at), false);
  assertEquals(matchingReceipt(tracked, { ...receipt, track_id: "funnel-other" }, at), false);
});

Deno.test("áudio incerto não entra na conciliação de recibos suportados", () => {
  assertEquals(reconcilable5895Type("audio"), false);
  assertEquals(reconcilable5895Type("video"), true);
  assertEquals(reconcilable5895Type("document"), true);
  assertEquals(reconcilable5895Type("interactive"), true);
});

// deno-lint-ignore no-explicit-any
function fakeDb(rows: any[]) {
  const store = new Map<string, any>(
    rows.map((r) => [String(r.id), structuredClone(r)]),
  );
  const updated: string[] = [];
  const db = {
    from() {
      // deno-lint-ignore no-explicit-any
      const ctx: any = { mode: "select", filters: {}, payload: null };
      // deno-lint-ignore no-explicit-any
      const builder: any = {
        select() {
          if (ctx.mode !== "update") return builder;
          const id = String(ctx.filters["id"]);
          const row = store.get(id);
          const d = row?.payload?.__funnel_delivery ?? {};
          if (row && d.last_outcome === "uncertain" && !d.followups_released_at) {
            store.set(id, { id, payload: ctx.payload });
            updated.push(id);
            return Promise.resolve({ data: [{ id }], error: null });
          }
          return Promise.resolve({ data: [], error: null });
        },
        // deno-lint-ignore no-explicit-any
        update(value: any) {
          ctx.mode = "update";
          ctx.payload = value.payload;
          return builder;
        },
        like() {
          return builder;
        },
        eq(col: string, val: unknown) {
          ctx.filters[col] = val;
          return builder;
        },
        is() {
          return builder;
        },
        limit() {
          return Promise.resolve({
            data: [...store.values()].map((r) => ({ id: r.id, payload: r.payload })),
            error: null,
          });
        },
      };
      return builder;
    },
  };
  return { db, store, updated };
}

Deno.test("age-out expira só peça 5895 incerta, não-liberada e com +72h", async () => {
  const now = Date.parse("2026-11-02T00:00:00Z");
  const h = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const delivery = (over: Record<string, unknown>) => ({
    id: String(over.id),
    payload: {
      media_url: "https://x.test/v.mp4",
      __funnel_delivery: {
        last_outcome: "uncertain",
        attempt_id: `att-${over.id}`,
        last_attempt_at: over.last_attempt_at,
        transport_stage: over.transport_stage ?? "await_receipt",
        ...(over.followups_released_at
          ? { followups_released_at: over.followups_released_at }
          : {}),
      },
    },
  });
  const velha = delivery({ id: "a", last_attempt_at: h(100) });
  const recente = delivery({ id: "b", last_attempt_at: h(10) });
  const liberada = delivery({
    id: "c",
    last_attempt_at: h(200),
    followups_released_at: h(190),
  });
  const { db, store, updated } = fakeDb([velha, recente, liberada]);
  // deno-lint-ignore no-explicit-any
  const expired = await expireStale5895Uncertain(db as any, now);
  assertEquals(expired, 1);
  assertEquals(updated, ["a"]);
  assertEquals(store.get("a").payload.__funnel_delivery.last_outcome, "expired");
  assertEquals(store.get("a").payload.__funnel_delivery.prior_last_outcome, "uncertain");
  assertEquals(store.get("b").payload.__funnel_delivery.last_outcome, "uncertain");
  assertEquals(store.get("c").payload.__funnel_delivery.last_outcome, "uncertain");
});
