import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hybridSendMedia, UncertainDeliveryError } from "../shared/hybrid.ts";

const route = {
  provider: "uazapi" as const,
  instance: "5895",
  token: "test",
  channelId: "test",
};
const recipient = "5511910363320";
const mediaUrl = "https://example.test/video.mp4";

for (const confirmed of [true, false]) {
  Deno.test(`vídeo async ${confirmed ? "confirma recibo" : "não confunde Queued com entrega"}`, async () => {
    const originalFetch = globalThis.fetch;
    const keys = {
      UAZAPI_URL: "https://provider.invalid",
      SUPABASE_URL: "https://db.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "test",
    };
    const prior = Object.fromEntries(
      Object.keys(keys).map((key) => [key, Deno.env.get(key)]),
    );
    const startedAt = Date.now();
    let sends = 0;
    try {
      for (const [key, value] of Object.entries(keys)) Deno.env.set(key, value);
      globalThis.fetch = async (url, init) => {
        if (String(url).endsWith("/send/media")) {
          sends++;
          const body = JSON.parse(String(init?.body));
          assertEquals(body.async, true);
          assertEquals(body.track_id, "funnel-attempt-1");
          assertEquals(body.track_source, "evohub-5895-funnel");
          return Response.json({ id: "provider-1", status: "Queued" });
        }
        if (String(url).endsWith("/message/find")) {
          return Response.json({
            messages: [{
              id: "provider-1",
              fromMe: true,
              chatid: `${recipient}@s.whatsapp.net`,
              messageTimestamp: startedAt + 100,
              messageType: "VideoMessage",
              sendPayload: { file: mediaUrl },
              track_id: confirmed ? "funnel-attempt-1" : "other",
              status: "Delivered",
            }],
          });
        }
        return Response.json([]);
      };
      const send = () =>
        hybridSendMedia(route, recipient, mediaUrl, "video", {
          asyncReceipt: {
            trackId: "funnel-attempt-1",
            startedAt,
            maxWaitMs: 0,
          },
        });
      if (confirmed) {
        const result = await send();
        assertEquals(result?.ok, true);
        assertEquals(
          (result?.data as { provider_status?: string }).provider_status,
          "Delivered",
        );
      } else {
        await assertRejects(send, UncertainDeliveryError);
      }
      assertEquals(sends, 1);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [key, value] of Object.entries(prior)) {
        value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      }
    }
  });
}
