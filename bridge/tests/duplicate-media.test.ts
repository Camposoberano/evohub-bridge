import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hybridSendMedia, UncertainDeliveryError } from "../shared/hybrid.ts";
import { handleOutgoing } from "../handlers/chatwoot-webhook.ts";
import { recentOutgoingCandidates } from "../handlers/sync-chatwoot-out.ts";
import { createConversationMessage } from "../shared/chatwoot.ts";
import type { DbClient } from "../shared/supabase.ts";

Deno.test("echo marcado não acessa banco nem envia mídia pelo webhook ou polling", async () => {
  const message = {
    id: 3219,
    message_type: "outgoing",
    content: "",
    attachments: [{ file_type: "video" }],
    content_attributes: { bridge_already_sent: true },
  };
  const db = {
    from: () => {
      throw new Error("não deve consultar ou enviar");
    },
  } as unknown as DbClient;
  await handleOutgoing(db, message);
  assertEquals(recentOutgoingCandidates([message], 0), []);
});

Deno.test("registro de mídia leva marcador antes do webhook poder ocorrer", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      const form = init?.body as FormData;
      assertEquals(form.get("content_attributes[bridge_already_sent]"), "true");
      return Response.json({ id: 123 });
    };
    await createConversationMessage(3219, {
      content: "",
      messageType: "outgoing",
      alreadySent: true,
      attachments: [{
        bytes: new Uint8Array([1]),
        contentType: "video/mp4",
        filename: "video.mp4",
      }],
    }, { url: "https://example.invalid", token: "test", accountId: "1" });
  } finally {
    globalThis.fetch = original;
  }
});

for (const failure of ["timeout", "http500", "invalid-body"]) {
  Deno.test(`mídia ${failure} tem resultado incerto e não libera fallback`, async () => {
    const original = globalThis.fetch;
    const keys = {
      UAZAPI_URL: "https://provider.invalid",
      SUPABASE_URL: "https://db.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "test",
    };
    const prior = Object.fromEntries(
      Object.keys(keys).map((key) => [key, Deno.env.get(key)]),
    );
    let sends = 0;
    try {
      for (const [key, value] of Object.entries(keys)) Deno.env.set(key, value);
      globalThis.fetch = async (url) => {
        if (String(url).includes("provider.invalid")) {
          sends++;
          if (failure === "timeout") {
            throw new DOMException("timeout", "AbortError");
          }
          if (failure === "http500") return Response.json({}, { status: 500 });
          return new Response("invalid", { status: 200 });
        }
        return Response.json([]);
      };
      await assertRejects(
        () =>
          hybridSendMedia(
            {
              provider: "uazapi",
              instance: "5895",
              token: "test",
              channelId: "test",
            },
            "5511999999999",
            "https://example.invalid/video.mp4",
            "video",
            {},
          ),
        UncertainDeliveryError,
      );
      assertEquals(sends, 1);
    } finally {
      globalThis.fetch = original;
      for (const [key, value] of Object.entries(prior)) {
        value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      }
    }
  });
}
