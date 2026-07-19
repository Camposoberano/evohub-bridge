export type HybridMenuButton = {
  id: string;
  title: string;
};

export function buildHybridMenuPayload(
  to: string,
  text: string,
  buttons: HybridMenuButton[],
  imageUrl?: string,
): Record<string, unknown> {
  return {
    number: to,
    type: "button",
    text,
    footerText: "Escolha uma opção:",
    choices: buttons.slice(0, 3).map((button) => button.title),
    imageButton: imageUrl || undefined,
    readchat: true,
    delay: 0,
  };
}

export function buildHybridMenuFallback(
  text: string,
  buttons: HybridMenuButton[],
): string {
  const choices = buttons.slice(0, 3).map((button, index) =>
    `${index + 1}. ${button.title}`
  ).join("\n");
  return `${text}\n\nResponda com uma opção:\n${choices}`;
}

export function normalizeHybridMenuClick(
  value: string | undefined,
): string | undefined {
  if (!value || /^(menu_|preco_|tam_|pag_|plantio_|nutricao_)/.test(value)) {
    return value;
  }
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    .toLowerCase();
  const aliases: Array<[RegExp, string]> = [
    [/\b(preco|valor|calcular|area)\b/, "menu_preco"],
    [/\b(plantar|plantio)\b/, "menu_plantio"],
    [/\b(nutricao|bromatologia|laudo)\b/, "menu_nutricao"],
    [/\b(video|resultado|depoimento)\b/, "menu_depoimento"],
    [/\b(cicero|duvida|interesse|atendente)\b/, "menu_humano"],
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1] ?? value;
}
