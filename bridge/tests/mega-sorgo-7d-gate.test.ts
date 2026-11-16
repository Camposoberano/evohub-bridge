import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isSevenDayWhatsAppChannel, sevenDayTestConversationAllowed,
} from "../shared/mega-sorgo-7d-gate.ts";

Deno.test("teste de sete dias fecha sem allowlist explícita", () => {
  assertEquals(sevenDayTestConversationAllowed(3509, ""), false);
  assertEquals(sevenDayTestConversationAllowed(3509, "3509, 3510"), true);
  assertEquals(sevenDayTestConversationAllowed(35, "3509"), false);
});

Deno.test("somente WhatsApp real 5895 e 6836 pode usar a versão nova", () => {
  assertEquals(isSevenDayWhatsAppChannel({ type: "whatsapp", name: "6836", phone_number: "5511999966836" }), true);
  assertEquals(isSevenDayWhatsAppChannel({ type: "whatsapp", name: "5895", phone_number: "5519999715895" }), true);
  assertEquals(isSevenDayWhatsAppChannel({ type: "facebook", name: "6836", phone_number: "5511999966836" }), false);
  assertEquals(isSevenDayWhatsAppChannel({ type: "whatsapp", name: "6836", phone_number: "5511999965895" }), false);
});
