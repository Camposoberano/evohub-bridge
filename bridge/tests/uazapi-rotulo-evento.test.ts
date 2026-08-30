import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { rotuloDeEvento } from "../handlers/uazapi-webhook.ts";

// A uazapi às vezes manda `event` como OBJETO. O `as string` que havia deixava o objeto
// inteiro virar o rótulo em events.event_type — levando telefone do cliente junto e
// inutilizando o índice (source, event_type, received_at), já que cada linha ficava única.

Deno.test("payload de recibo usa o tipo, não o objeto do evento", () => {
  const recibo = {
    type: "ReadReceipt",
    event: {
      Chat: "553488413727@s.whatsapp.net",
      Sender: "5519999715895@s.whatsapp.net",
      Type: "Delivered",
      sender_pn: "553488413727@s.whatsapp.net",
    },
  };
  assertEquals(rotuloDeEvento(recibo), "ReadReceipt");
});

Deno.test("payload de mensagem continua com o rótulo de sempre", () => {
  assertEquals(rotuloDeEvento({ EventType: "messages", message: {} }), "messages");
  assertEquals(rotuloDeEvento({ EventType: "chats", chat: {} }), "chats");
  assertEquals(rotuloDeEvento({ event: "message.exchange" }), "message.exchange");
});

Deno.test("rótulo gigante é truncado", () => {
  const gigante = "x".repeat(500);
  assertEquals(rotuloDeEvento({ type: gigante }).length, 120);
});

Deno.test("sem rótulo utilizável cai no genérico", () => {
  assertEquals(rotuloDeEvento({}), "uazapi_event");
  assertEquals(rotuloDeEvento({ event: {}, type: "   " }), "uazapi_event");
  assertEquals(rotuloDeEvento({ event: 42 }), "uazapi_event");
});

// Consequência silenciosa que a correção destrava: a guarda de ReadReceipt em
// isInboundUazapiEvent comparava contra o objeto e nunca casava.
Deno.test("nenhum telefone sobrevive no rótulo", () => {
  const r = rotuloDeEvento({
    type: "ReadReceipt",
    event: { sender_pn: "553488413727@s.whatsapp.net" },
  });
  assertEquals(r.includes("553488413727"), false);
});
