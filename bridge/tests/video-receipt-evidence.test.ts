import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  deliveryMetadata,
  withConfirmedVideoReceipt,
} from "../shared/funnel-delivery.ts";

Deno.test("recibo confirmado do vídeo fica no estado durável", () => {
  const state = withConfirmedVideoReceipt(
    { attempts: 1, attempt_id: "attempt-1", last_outcome: "started" },
    "uazapi",
    { message_id: "provider-1", provider_status: "Delivered" },
  );
  assertEquals(state.provider_id, "provider-1");
  assertEquals(state.provider_status, "Delivered");
  assertEquals(state.provider_copies, 1);
  assertEquals(state.confirmed_from, "uazapi_message_history");
  const restored = deliveryMetadata({ __funnel_delivery: state });
  assertEquals(restored.provider_id, state.provider_id);
  assertEquals(restored.provider_status, state.provider_status);
  assertEquals(restored.provider_copies, state.provider_copies);
  assertEquals(restored.confirmed_from, state.confirmed_from);
});

Deno.test("aceitação sem entrega não vira comprovante", () => {
  const original = { attempts: 1, last_outcome: "started" as const };
  assertEquals(
    withConfirmedVideoReceipt(original, "uazapi", {
      message_id: "provider-1",
      provider_status: "Sent",
    }),
    original,
  );
  assertEquals(
    withConfirmedVideoReceipt(original, "official", {
      message_id: "provider-1",
      provider_status: "Delivered",
    }),
    original,
  );
});
