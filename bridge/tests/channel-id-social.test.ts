import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { achaIdSocial } from "../handlers/channel-sync.ts";

// A entrada da Meta acha o canal por page_id (FB) ou ig_id (IG). Sem esse número a mensagem
// não casa com canal nenhum e é DESCARTADA em silêncio — foi o que deixou `david face` e
// `david inst` três dias ativos e com zero conversa, em 05-08/09.
//
// Quem preenchia era o evento channel_connected, uma única vez. Se o detalhe do Hub ainda
// não trouxesse a conexão naquele instante, o canal nascia mudo para sempre.

Deno.test("Facebook: pega o page_id da conexão", () => {
  const det = { facebook_connection: { page_id: "716178071577280", page_name: "Agri fertil" } };
  assertEquals(achaIdSocial(det, "facebook"), "716178071577280");
});

Deno.test("Instagram: instagram_user_id tem precedência sobre instagram_id", () => {
  // São números DIFERENTES, e o webhook de entrada traz o primeiro. Trocar um pelo outro
  // deixa o canal cadastrado e mesmo assim sem casar com a mensagem que chega.
  const det = {
    instagram_connection: {
      instagram_id: "28435955406093229",
      instagram_user_id: "17841469868039654",
      username: "davidsobreira__",
    },
  };
  assertEquals(achaIdSocial(det, "instagram"), "17841469868039654");
});

Deno.test("Instagram sem instagram_user_id cai nos alternativos", () => {
  assertEquals(achaIdSocial({ instagram_connection: { ig_id: "123" } }, "instagram"), "123");
  assertEquals(achaIdSocial({ instagram_connection: { instagram_id: "456" } }, "instagram"), "456");
});

Deno.test("conexão ausente devolve null em vez de explodir", () => {
  assertEquals(achaIdSocial({}, "facebook"), null);
  assertEquals(achaIdSocial({}, "instagram"), null);
  assertEquals(achaIdSocial({ facebook_connection: {} }, "facebook"), null);
});

Deno.test("canal que não é social não tem identificador de página", () => {
  const det = { whatsapp_connection: { phone_number_id: "999" } };
  assertEquals(achaIdSocial(det, "whatsapp"), null, "WhatsApp roteia por phone_number_id");
});
