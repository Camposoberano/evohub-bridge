import {
  mergeLeadAttributes,
  normalizeLeadAttribution,
  sourceSnapshot,
} from "../shared/lead-profile.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("normaliza referencia de anuncio da Meta e provedores hibridos", () => {
  const result = normalizeLeadAttribution({
    externalAdReply: {
      source_id: "ad-123",
      headline: "Mega Sorgo",
      creative_id: "creative-9",
      source_url: "https://example.test/post",
    },
  });
  assertEquals(result.ad_id, "ad-123");
  assertEquals(result.ad_name, "Mega Sorgo");
  assertEquals(result.creative_id, "creative-9");
});

Deno.test("preserva primeira origem e atualiza ultima atribuicao", () => {
  const channel = {
    id: "channel-1",
    name: "Campo Soberano 5895",
    type: "whatsapp",
    phone_number: "55885895",
    owner_name: "Cicero",
  };
  const first = mergeLeadAttributes({}, channel, "558899999999", {
    ad_id: "ad-1",
  });
  const second = mergeLeadAttributes(first, channel, "558899999999", {
    ad_id: "ad-2",
  });
  assertEquals(
    (second.first_attribution as Record<string, unknown>).ad_id,
    "ad-1",
  );
  assertEquals(
    (second.last_attribution as Record<string, unknown>).ad_id,
    "ad-2",
  );
  assertEquals(second.source_owner_name, "Cicero");
});

Deno.test("snapshot registra canal receptor e identificador do lead", () => {
  const result = sourceSnapshot({
    name: "Campo Soberano IG",
    type: "instagram",
    ig_id: "ig-business-1",
  }, "igsid-99");
  assertEquals(result.source_number, "ig-business-1");
  assertEquals(result.lead_platform_id, "igsid-99");
  assertEquals(result.source_channel_type, "instagram");
});
