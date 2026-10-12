import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AsyncVideoReceiptError,
  matchingAsyncVideoReceipt,
  shouldUseAsyncVideoReceipt,
  waitForVideoReceipt,
} from "../shared/async-video-receipt.ts";

const at = Date.parse("2026-10-12T15:00:00Z");
const criteria = {
  recipient: "5511910363320",
  mediaUrl: "https://example.test/video.mp4",
  trackId: "funnel-attempt-1",
  providerId: "provider-1",
  startedAt: at,
};
const receipt = {
  fromMe: true,
  chatid: "5511910363320@s.whatsapp.net",
  messageType: "VideoMessage",
  sendPayload: { file: criteria.mediaUrl },
  track_id: criteria.trackId,
  id: criteria.providerId,
  messageTimestamp: at + 5_000,
  status: "Delivered",
};

Deno.test("modo async fica restrito ao vídeo agendado do funil 5895", () => {
  const approved = {
    hasHybridRoute: true,
    scheduled: true,
    type: "video",
    funnel: "mega-sorgo-5895-20260930",
    channelPhone: "+55 19 99971-5895",
  };
  assertEquals(shouldUseAsyncVideoReceipt(approved), true);
  assertEquals(
    shouldUseAsyncVideoReceipt({ ...approved, scheduled: false }),
    false,
  );
  assertEquals(
    shouldUseAsyncVideoReceipt({ ...approved, type: "image" }),
    false,
  );
  assertEquals(
    shouldUseAsyncVideoReceipt({
      ...approved,
      funnel: "mega-sorgo-social-20260930",
    }),
    false,
  );
  assertEquals(
    shouldUseAsyncVideoReceipt({
      ...approved,
      channelPhone: "+55 19 99971-6836",
    }),
    false,
  );
  assertEquals(
    shouldUseAsyncVideoReceipt({ ...approved, hasHybridRoute: false }),
    false,
  );
});

Deno.test("async video só aceita recibo da tentativa e do destinatário", () => {
  assertEquals(matchingAsyncVideoReceipt(receipt, criteria), true);
  for (
    const changed of [
      { status: "Queued" },
      { track_id: "outro" },
      { chatid: "5511999999999@s.whatsapp.net" },
      { id: "outro" },
      { fromMe: false },
      { messageTimestamp: at + 181_000 },
      { sendPayload: { file: "https://example.test/outro.mp4" } },
    ]
  ) {
    assertEquals(
      matchingAsyncVideoReceipt({ ...receipt, ...changed }, criteria),
      false,
    );
  }
});

Deno.test("async video retorna somente um recibo confirmado", async () => {
  const got = await waitForVideoReceipt({ token: "test" }, criteria, {
    maxWaitMs: 0,
    lookup: async () => [receipt],
  });
  assertEquals(got, receipt);
  await assertRejects(
    () =>
      waitForVideoReceipt({ token: "test" }, criteria, {
        maxWaitMs: 0,
        lookup: async () => [{ ...receipt, status: "Queued" }],
      }),
    AsyncVideoReceiptError,
    "missing",
  );
  await assertRejects(
    () =>
      waitForVideoReceipt({ token: "test" }, criteria, {
        maxWaitMs: 0,
        lookup: async () => [receipt, receipt],
      }),
    AsyncVideoReceiptError,
    "ambiguous",
  );
  await assertRejects(
    () =>
      waitForVideoReceipt({ token: "test" }, criteria, {
        maxWaitMs: 0,
        lookup: async () => {
          throw new Error("provider down");
        },
      }),
    AsyncVideoReceiptError,
    "lookup_failed",
  );
});
