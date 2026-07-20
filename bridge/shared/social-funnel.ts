type Json = Record<string, unknown>;

export type SocialMessage = {
  message: Json;
  kind: "text" | "image" | "video" | "audio";
};

export function socialPriceActionClaimKey(
  channelId: string,
  messageId: string,
  actionId: string,
): string {
  return `social-price-action:${channelId}:${messageId}:${actionId}`;
}

type Choice = { id: string; title: string };

function quickReplies(choices: Choice[]): Json[] {
  return choices.slice(0, 13).map((choice) => ({
    content_type: "text",
    title: choice.title.slice(0, 20),
    payload: choice.id,
  }));
}

export function renderSocialFunnelMessages(
  type: string,
  payload: Json,
  platform?: "facebook" | "instagram",
): SocialMessage[] {
  if (type === "text") {
    const content = String(payload.content ?? "").trim();
    return content ? [{ kind: "text", message: { text: content } }] : [];
  }

  if (type === "image" || type === "video" || type === "audio") {
    const url = String(payload.media_url ?? "").trim();
    if (!url) return [];
    const result: SocialMessage[] = [{
      kind: type,
      message: {
        attachment: {
          type,
          payload: { url, is_reusable: true },
        },
      },
    }];
    const caption = String(payload.caption ?? "").trim();
    if (caption && type !== "audio") {
      result.push({ kind: "text", message: { text: caption } });
    }
    return result;
  }

  if (type === "interactive") {
    const text = String(payload.text ?? "").trim();
    const buttons = (payload.buttons ?? []) as Choice[];
    if (!text || buttons.length === 0) return [];
    const result: SocialMessage[] = [];
    const headerImage = String(payload.header_image ?? "").trim();
    if (headerImage) {
      result.push({
        kind: "image",
        message: {
          attachment: {
            type: "image",
            payload: { url: headerImage, is_reusable: true },
          },
        },
      });
    }
    if (platform === "facebook") {
      result.push({
        kind: "text",
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "button",
              text,
              buttons: buttons.slice(0, 3).map((button) => ({
                type: "postback",
                title: button.title.slice(0, 20),
                payload: button.id,
              })),
            },
          },
        },
      });
      return result;
    }
    result.push({
      kind: "text",
      message: { text, quick_replies: quickReplies(buttons) },
    });
    return result;
  }

  if (type === "list") {
    const text = String(payload.text ?? "").trim();
    const sections = (payload.sections ?? []) as {
      rows?: Choice[];
    }[];
    const rows = sections.flatMap((section) => section.rows ?? []);
    if (!text || rows.length === 0) return [];
    return [{
      kind: "text",
      message: { text, quick_replies: quickReplies(rows) },
    }];
  }

  return [];
}

function normalizeReply(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function inferSocialPriceReply(
  reply: string,
  previousInteractive: string,
): string | null {
  const answer = normalizeReply(reply);
  const prompt = normalizeReply(previousInteractive);
  const selectedAnswer = answer.replace(/^meta ai\s+/, "");

  if (prompt.includes("qual destas areas")) {
    if (selectedAnswer === "2 hectares") return "tam_10kg";
    if (selectedAnswer === "4 hectares ou mais") return "tam_20kg";
    return null;
  }

  if (prompt.includes("qual area") || prompt.includes("tamanho da area")) {
    if (selectedAnswer === "meio hectare") return "tam_2kg";
    if (selectedAnswer === "1 hectare") return "tam_4kg";
    if (selectedAnswer === "2 hectares ou mais") return "preco_area_maior";
    return null;
  }

  if (prompt.includes("posso garantir")) {
    if (selectedAnswer === "quero garantir") return "preco_comprar";
    if (selectedAnswer === "pagamento") return "preco_pagamento";
    if (selectedAnswer === "outra area") return "preco_tamanho";
    return null;
  }

  if (prompt.includes("como o senhor prefere pagar")) {
    if (selectedAnswer === "pix") return "pag_pix";
    if (selectedAnswer === "cartao") return "pag_cartao";
    if (selectedAnswer === "boleto") return "pag_boleto";
  }

  return null;
}
