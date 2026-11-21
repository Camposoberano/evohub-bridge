import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isSevenDaySocialChannel,
  isSevenDayWhatsAppChannel,
  sevenDayLiveMode,
  sevenDaySocialChannelIds,
  sevenDayTestConversationAllowed,
  shouldSkipSevenDaySocialAudio,
} from "../shared/mega-sorgo-7d-gate.ts";

const IG_SORGO_BR = "1f056c55-fd58-4d55-943f-7d18c0dbc43b"; // Instagram sorgo brasileiro (Fase 1)
const IG_ATENDIMENTO = "93a082b0-e169-4cf8-9b1f-6e93758bf908"; // Instagram Atendimento IG (Fase 2)
const FB_CAMPO = "2e49dea3-9d93-4f5f-ad54-02882956d1ed"; // Facebook campo soberano
const IG_FORA = "66c6120b-4f92-4e5b-9d00-312c6f43456d"; // IG não aprovado (david inst)

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

Deno.test("allowlist social do 7d: aprovado+habilitado libera; inválida/vazia fecha", () => {
  // Fase 1: só o IG sorgo brasileiro.
  assertEquals(sevenDaySocialChannelIds(IG_SORGO_BR).size, 1);
  assertEquals([...sevenDaySocialChannelIds(`${IG_SORGO_BR},${FB_CAMPO}`)].sort(),
    [FB_CAMPO, IG_SORGO_BR].sort());
  // Off by default: env vazia = desligado.
  assertEquals(sevenDaySocialChannelIds("").size, 0);
  assertEquals(sevenDaySocialChannelIds("   ").size, 0);
  // Fail closed: id de fora anula a lista inteira; duplicado idem.
  assertEquals(sevenDaySocialChannelIds(`${IG_SORGO_BR},${IG_FORA}`).size, 0);
  assertEquals(sevenDaySocialChannelIds(`${IG_SORGO_BR},${IG_SORGO_BR}`).size, 0);
});

Deno.test("canal social do 7d exige tipo IG/FB, id aprovado E habilitado", () => {
  const enabled = new Set([IG_SORGO_BR]);
  // IG aprovado + habilitado → true.
  assertEquals(isSevenDaySocialChannel({ id: IG_SORGO_BR, type: "instagram" }, enabled), true);
  // Aprovado mas NÃO habilitado (Fase 2) → false.
  assertEquals(isSevenDaySocialChannel({ id: IG_ATENDIMENTO, type: "instagram" }, enabled), false);
  // Habilitado também cobre Facebook.
  assertEquals(
    isSevenDaySocialChannel({ id: FB_CAMPO, type: "facebook" }, new Set([FB_CAMPO])),
    true,
  );
  // id de fora dos aprovados → false mesmo se "habilitado".
  assertEquals(isSevenDaySocialChannel({ id: IG_FORA, type: "instagram" }, new Set([IG_FORA])), false);
  // tipo errado (WhatsApp) nunca é social.
  assertEquals(isSevenDaySocialChannel({ id: IG_SORGO_BR, type: "whatsapp" }, enabled), false);
  // WhatsApp 5895/6836 permanece intocado pelo gate social.
  assertEquals(
    isSevenDaySocialChannel({ type: "whatsapp", name: "5895", phone_number: "5519999715895" }, enabled),
    false,
  );
});

Deno.test("roteamento do enroll pro 7d social: live + canal habilitado", () => {
  // A condição que enrollIfNew / funil-control / n8n-queue usam para rotear o IG ao 7d.
  const enabled = new Set([IG_SORGO_BR]);
  const igLead = { id: IG_SORGO_BR, type: "instagram" };
  Deno.env.delete("MEGA_SORGO_7D_LIVE");
  assertEquals(sevenDayLiveMode() && isSevenDaySocialChannel(igLead, enabled), false);
  Deno.env.set("MEGA_SORGO_7D_LIVE", "true");
  try {
    assertEquals(sevenDayLiveMode() && isSevenDaySocialChannel(igLead, enabled), true);
    // Canal social não habilitado não entra mesmo ao vivo.
    assertEquals(
      sevenDayLiveMode() && isSevenDaySocialChannel({ id: IG_ATENDIMENTO, type: "instagram" }, enabled),
      false,
    );
  } finally {
    Deno.env.delete("MEGA_SORGO_7D_LIVE");
  }
});

Deno.test("áudio do 7d em canal social é pulado; demais tipos/funis não", () => {
  // IG/FB + áudio + 7d → pula.
  assertEquals(shouldSkipSevenDaySocialAudio("instagram", "mega-sorgo-7d-v1", "audio"), true);
  assertEquals(shouldSkipSevenDaySocialAudio("facebook", "mega-sorgo-7d-v1", "audio"), true);
  // WhatsApp mantém o áudio (nota de voz nativa).
  assertEquals(shouldSkipSevenDaySocialAudio("whatsapp", "mega-sorgo-7d-v1", "audio"), false);
  // Outros tipos do 7d no social seguem (tradução social).
  assertEquals(shouldSkipSevenDaySocialAudio("instagram", "mega-sorgo-7d-v1", "video"), false);
  assertEquals(shouldSkipSevenDaySocialAudio("instagram", "mega-sorgo-7d-v1", "image"), false);
  // Áudio do funil social n8n antigo NÃO é pulado (mantém a conversão existente).
  assertEquals(shouldSkipSevenDaySocialAudio("instagram", "mega-sorgo-social-20260930", "audio"), false);
});
