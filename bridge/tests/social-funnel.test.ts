import { renderSocialFunnelMessages } from "../shared/social-funnel.ts";
import { recoveryPieces } from "../shared/recovery-content.ts";

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
  assert(
    messages[1].message.text === "Veja os valores",
    "legenda deve ser preservada",
  );
});

Deno.test("funil social converte botões em respostas rápidas", () => {
  const messages = renderSocialFunnelMessages("interactive", {
    text: "Qual área?",
    buttons: [
      { id: "tam_2kg", title: "Meio hectare" },
      { id: "tam_4kg", title: "1 hectare" },
    ],
  });
  const replies = messages[0].message.quick_replies as Record<
    string,
    unknown
  >[];
  assert(replies.length === 2, "deve manter as duas opções");
  assert(
    replies[0].payload === "tam_2kg",
    "payload deve manter a ação comercial",
  );
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
  assert(
    replies.length === 13,
    "Meta aceita no máximo treze respostas rápidas",
  );
});

Deno.test("funil social preserva vídeo e legenda", () => {
  const messages = renderSocialFunnelMessages("video", {
    media_url: "https://example.com/depoimento.mp4",
    caption: "Resultado no campo",
  });
  assert(messages.length === 2, "vídeo e legenda devem ser entregues");
  assert(messages[0].kind === "video", "primeira mensagem deve ser vídeo");
  assert(
    messages[1].message.text === "Resultado no campo",
    "legenda deve ser enviada depois do vídeo",
  );
});

Deno.test("as quatro recuperações possuem formato válido para Instagram", () => {
  for (let variation = 1; variation <= 4; variation++) {
    const pieces = recoveryPieces(variation, {
      image: "https://example.com/card.jpg",
      video: "https://example.com/video.mp4",
      audio: "https://example.com/audio.ogg",
    });
    const rendered = pieces.flatMap((piece) =>
      renderSocialFunnelMessages(piece.type, piece.payload)
    );
    assert(rendered.length > 0, `recuperação ${variation} deve ser entregável`);
  }
});
