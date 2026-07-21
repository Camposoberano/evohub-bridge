import {
  inferSocialPriceReply,
  inferSocialPriceReplyFromPrompts,
  renderSocialFunnelMessages,
  socialPriceActionClaimKey,
} from "../shared/social-funnel.ts";
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

Deno.test("Facebook usa botões persistentes com postback", () => {
  const messages = renderSocialFunnelMessages("interactive", {
    text: "Qual área?",
    buttons: [
      { id: "tam_2kg", title: "Meio hectare" },
      { id: "tam_4kg", title: "1 hectare" },
    ],
  }, "facebook");
  const attachment = messages[0].message.attachment as Record<string, unknown>;
  const payload = attachment.payload as Record<string, unknown>;
  const buttons = payload.buttons as Record<string, unknown>[];
  assert(payload.template_type === "button", "deve usar o template de botão");
  assert(buttons[1].payload === "tam_4kg", "postback deve preservar a ação");
});

Deno.test("cartão comercial usa imagem e botão externo no Facebook e Instagram", () => {
  for (const platform of ["facebook", "instagram"] as const) {
    const messages = renderSocialFunnelMessages("interactive", {
      card_title: "Fale com a Campo Soberano",
      header_image: "https://example.com/campo.png",
      text: "Fale agora com o Cícero.",
      buttons: [{
        id: "contact_whatsapp",
        title: "Chamar no WhatsApp",
        url: "https://wa.me/5519999999999",
      }],
    }, platform);
    assert(
      messages[0].message.text === "Fale agora com o Cícero.",
      "deve preservar o texto completo",
    );
    const attachment = messages[1].message.attachment as Record<
      string,
      unknown
    >;
    const payload = attachment.payload as Record<string, unknown>;
    const elements = payload.elements as Record<string, unknown>[];
    const buttons = elements[0].buttons as Record<string, unknown>[];
    assert(
      payload.template_type === "generic",
      `${platform} deve usar cartão genérico`,
    );
    assert(
      elements[0].image_url === "https://example.com/campo.png",
      "deve preservar a imagem",
    );
    assert(buttons[0].type === "web_url", "deve usar botão de link externo");
  }
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

Deno.test("Facebook divide listas longas em botões persistentes", () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({
    id: `tema_${index + 1}`,
    title: `Tema ${index + 1}`,
  }));
  const messages = renderSocialFunnelMessages("list", {
    text: "Escolha um tema",
    sections: [{ rows }],
  }, "facebook");
  assert(messages.length === 4, "dez opções devem virar quatro blocos");
  for (const message of messages) {
    const attachment = message.message.attachment as Record<string, unknown>;
    const payload = attachment.payload as Record<string, unknown>;
    const buttons = payload.buttons as Record<string, unknown>[];
    assert(payload.template_type === "button", "deve usar botão persistente");
    assert(buttons.length <= 3, "cada bloco deve respeitar o limite da Meta");
  }
  const lastAttachment = messages[3].message.attachment as Record<
    string,
    unknown
  >;
  const lastPayload = lastAttachment.payload as Record<string, unknown>;
  const lastButtons = lastPayload.buttons as Record<string, unknown>[];
  assert(
    lastButtons[0].payload === "tema_10",
    "a última opção deve ser preservada",
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

Deno.test("clique de preço sincronizado pelo Instagram recupera o payload", () => {
  const prompt =
    "Qual área o senhor pretende plantar? [Meio hectare / 1 hectare / 2 hectares ou mais]";
  assert(
    inferSocialPriceReply("1 hectare", prompt) === "tam_4kg",
    "deve recuperar o pacote de 4 kg",
  );
  assert(
    inferSocialPriceReply("@Meta AI 1 hectare", prompt) === "tam_4kg",
    "deve ignorar o prefixo automático do Facebook",
  );
  assert(
    inferSocialPriceReply("2 hectares ou mais", prompt) ===
      "preco_area_maior",
    "deve abrir a segunda escolha de área",
  );
});

Deno.test("seletor de outra área reconhece todas as opções", () => {
  const prompt =
    "Qual outra área o senhor quer calcular? [Meio hectare / 1 hectare / 2 hectares ou mais]";
  assert(
    inferSocialPriceReply("Meio hectare", prompt) === "tam_2kg",
    "deve recuperar o pacote de 2 kg",
  );
  assert(
    inferSocialPriceReply("1 hectare", prompt) === "tam_4kg",
    "deve recuperar o pacote de 4 kg",
  );
  assert(
    inferSocialPriceReply("2 hectares ou mais", prompt) ===
      "preco_area_maior",
    "deve abrir as áreas maiores",
  );
});

Deno.test("botão antigo continua válido depois de abrir pagamento", () => {
  const prompts = [
    "Como o senhor prefere pagar? [PIX / Cartão / Boleto]",
    "Posso garantir o seu? [Quero garantir / Pagamento / Outra área]",
  ];
  assert(
    inferSocialPriceReplyFromPrompts("Quero garantir", prompts) ===
      "preco_comprar",
    "deve encontrar o card compatível além do último menu",
  );
});

Deno.test("texto comum não vira clique sem menu compatível", () => {
  assert(
    inferSocialPriceReply("1 hectare", "Bom dia, como posso ajudar?") === null,
    "resposta comum não pode disparar preço",
  );
});

Deno.test("webhook e sincronizador compartilham a trava do clique social", () => {
  const key = socialPriceActionClaimKey("canal", "mensagem", "preco_tamanho");
  assert(
    key === "social-price-action:canal:mensagem:preco_tamanho",
    "a chave deve identificar evento e ação",
  );
});
