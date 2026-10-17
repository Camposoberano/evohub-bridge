import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { inboundCandidate, inboundState } from "../shared/inbound-incidents.ts";

Deno.test("o clique do 5895 é identificado sem expor telefone inteiro", () => {
  const candidate = inboundCandidate({
    id: "evento-1",
    received_at: "2026-10-17T19:43:00Z",
    payload: {
      instanceName: "5895",
      message: {
        id: "5519999715895:3A64FFFABF87780AC9C5",
        fromMe: false,
        isGroup: false,
        sender_pn: "5516997671151@s.whatsapp.net",
        mediaType: "list_response",
        buttonOrListid: "menu_nutricao",
        content: { title: "🧪 Info nutricional" },
      },
    },
  });
  assertEquals(candidate?.choice, "menu_nutricao");
  assertEquals(candidate?.contactSuffix, "••••1151");
  assertEquals(candidate?.instance, "5895");
  assertEquals(
    inboundState(120_000, true, candidate!.choice, false, false),
    "missing_action",
  );
});

Deno.test("só considera falha depois da janela de processamento", () => {
  assertEquals(inboundState(20_000, false, null, false, false), null);
  assertEquals(
    inboundState(120_000, false, null, false, false),
    "missing_message",
  );
  assertEquals(inboundState(120_000, true, "menu_nutricao", true, false), null);
  assertEquals(
    inboundState(120_000, true, "menu_nutricao", true, true),
    "action_failed",
  );
});

Deno.test("chamadas não são tratadas como entrada de cliente", () => {
  assertEquals(
    inboundCandidate({
      id: "evento-2",
      received_at: "2026-10-17T19:43:00Z",
      payload: {
        instanceName: "5895",
        message: { id: "call_1", fromMe: false },
      },
    }),
    null,
  );
});
