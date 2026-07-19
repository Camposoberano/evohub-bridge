type Json = Record<string, unknown>;

export type SocialMessage = {
  message: Json;
  kind: "text" | "image" | "video" | "audio";
};

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
