import { renderSocialFunnelMessages } from "../shared/social-funnel.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("funil social envia imagem real e legenda", () => {
  const messages = renderSocialFunnelMessages("image", {
    media_url: "https://example.com/preco.jpg",
    caption: "Veja os valores",
  });
  assert(messages.length === 2, "imagem e legenda devem ser duas mensagens");
  assert(messages[0].kind === "image", "primeira mensagem deve ser imagem");
  assert(messages[1].message.text === "Veja os valores", "legenda deve ser preservada");
});

Deno.test("funil social converte botões em respostas rápidas", () => {
  const messages = renderSocialFunnelMessages("interactive", {
    text: "Qual área?",
    buttons: [
      { id: "tam_2kg", title: "Meio hectare" },
      { id: "tam_4kg", title: "1 hectare" },
    ],
  });
  const replies = messages[0].message.quick_replies as Record<string, unknown>[];
  assert(replies.length === 2, "deve manter as duas opções");
  assert(replies[0].payload === "tam_2kg", "payload deve manter a ação comercial");
});

Deno.test("funil social converte lista em até treze respostas rápidas", () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({
    id: `tema_${index}`,
    title: `Tema ${index}`,
  }));
  const messages = renderSocialFunnelMessages("list", {
    text: "Escolha um tema",
    sections: [{ rows }],
  });
  const replies = messages[0].message.quick_replies as unknown[];
  assert(replies.length === 13, "Meta aceita no máximo treze respostas rápidas");
});
