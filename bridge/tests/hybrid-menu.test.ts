import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildHybridMenuFallback,
  buildHybridMenuPayload,
  normalizeHybridButtonReply,
  normalizeHybridMenuClick,
} from "../shared/hybrid-menu.ts";

Deno.test("menu híbrido usa endpoint compatível com botões uazapi", () => {
  const payload = buildHybridMenuPayload(
    "5585999999999",
    "Como posso ajudar?",
    [
      { id: "menu_preco", title: "Ver preço" },
      { id: "menu_plantio", title: "Como plantar" },
      { id: "menu_humano", title: "Falar com Cícero" },
      { id: "ignorado", title: "Quarto" },
    ],
    "https://example.com/card.jpg",
  );

  assertEquals(payload.type, "button");
  assertEquals(payload.choices, [
    "Ver preço",
    "Como plantar",
    "Falar com Cícero",
  ]);
  assertEquals(payload.imageButton, "https://example.com/card.jpg");
  assertEquals(payload.scheduled_for, undefined);
});

Deno.test("cliques híbridos das recuperações voltam para o menu correto", () => {
  assertEquals(normalizeHybridMenuClick("Calcular preço 💰"), "menu_preco");
  assertEquals(normalizeHybridMenuClick("Como plantar 🌱"), "menu_plantio");
  assertEquals(normalizeHybridMenuClick("Ver nutrição 🧪"), "menu_nutricao");
  assertEquals(normalizeHybridMenuClick("Tirar uma dúvida"), "menu_humano");
  assertEquals(normalizeHybridMenuClick("menu_preco"), "menu_preco");
});

Deno.test("normaliza respostas exatas dos botões de preço", () => {
  assertEquals(normalizeHybridButtonReply("1 hectare"), "tam_4kg");
  assertEquals(
    normalizeHybridButtonReply("2 hectares ou mais"),
    "preco_area_maior",
  );
  assertEquals(
    normalizeHybridButtonReply("🛒 Quero garantir"),
    "preco_comprar",
  );
  assertEquals(normalizeHybridButtonReply("Cartão"), "pag_cartao");
  assertEquals(normalizeHybridButtonReply("Tenho 1 hectare"), undefined);
});

Deno.test("menu híbrido tem fallback textual acionável", () => {
  const text = buildHybridMenuFallback("Como posso ajudar?", [
    { id: "menu_preco", title: "Ver preço" },
    { id: "menu_plantio", title: "Como plantar" },
  ]);
  assertEquals(
    text,
    "Como posso ajudar?\n\nResponda com uma opção:\n1. Ver preço\n2. Como plantar",
  );
});
