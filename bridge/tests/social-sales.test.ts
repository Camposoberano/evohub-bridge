import {
  inferSocialMenuAction,
  inferSocialSalesIntent,
  socialContactText,
  socialSalesClaimKey,
} from "../shared/social-sales.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("pedido de contato tem prioridade comercial", () => {
  assert(
    inferSocialSalesIntent("Quero mais informações e falar com o Cícero") ===
      "contact",
    "contato deve ganhar de informação genérica",
  );
});

Deno.test("reconhece mensagens de anúncio em português e espanhol", () => {
  assert(
    inferSocialSalesIntent("Olá! Posso ter mais informações sobre isso?") ===
      "info",
    "deve reconhecer a mensagem padrão em português",
  );
  assert(
    inferSocialSalesIntent(
      "¡Hola! Me gustaría conseguir más información sobre esto.",
    ) ===
      "info",
    "deve reconhecer a mensagem padrão em espanhol",
  );
});

Deno.test("saudação comum não dispara atendimento automático", () => {
  assert(
    inferSocialSalesIntent("Boa tarde") === null,
    "saudação sozinha não pode iniciar automação comercial",
  );
});

Deno.test("sincronizador reconhece o texto dos botões comerciais", () => {
  assert(
    inferSocialMenuAction("Ver preço") === "menu_preco",
    "deve abrir preço",
  );
  assert(
    inferSocialMenuAction("Ver vídeos") === "menu_depoimento",
    "deve abrir vídeos",
  );
  assert(
    inferSocialMenuAction("Falar com Cícero") === "menu_humano",
    "deve abrir contato",
  );
});

Deno.test("cartão inclui link de WhatsApp e convite para deixar o número", () => {
  const text = socialContactText("https://wa.me/5511999999999");
  assert(
    text.includes("https://wa.me/5511999999999"),
    "deve incluir fallback clicável",
  );
  assert(text.includes("WhatsApp com DDD"), "deve pedir o contato com DDD");
});

Deno.test("webhook e sincronizador compartilham a trava comercial", () => {
  assert(
    socialSalesClaimKey("canal", "mensagem", "contact") ===
      "social-sales:canal:mensagem:contact",
    "a trava deve identificar canal, mensagem e intenção",
  );
});
