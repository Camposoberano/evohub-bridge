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
  if (
    !value ||
    /^(menu_|f[1-5]_|preco_|tam_|pag_|uso_|plantio_|nutricao_|grp_|cat_|prod_|acao_|pg_|quali_obj_)/
      .test(value)
  ) {
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
    [/\b(silagem)\b/, "uso_silagem"],
    [/\b(pastejo|pasto)\b/, "uso_pastejo"],
    [/\b(outro uso|outra finalidade)\b/, "uso_outro"],
    [/\b(uso|finalidade)\b/, "menu_uso"],
    [/\b(cicero|duvida|interesse|atendente)\b/, "menu_humano"],
    [/\bquero o material\b/, "menu_isca_silagem"],
    [/\bagora nao\b/, "menu_isca_nao_silagem"],
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1] ??
    normalizeHybridButtonReply(value) ?? value;
}

export function normalizeHybridButtonReply(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    .toLowerCase();
  const replies: Record<string, string> = {
    "silagem": "uso_silagem",
    "pastejo": "uso_pastejo",
    "pasto": "uso_pastejo",
    "outro": "uso_outro",
    "outro uso": "uso_outro",
    "outra finalidade": "uso_outro",
    "meio hectare": "tam_2kg",
    "1 hectare": "tam_4kg",
    "1 hectare 4 kg": "tam_4kg",
    "2 hectares ou mais": "preco_area_maior",
    "2 hectares": "tam_10kg",
    "2 hectares 10 kg": "tam_10kg",
    "4 hectares": "tam_20kg",
    "4 hectares ou mais": "tam_20kg",
    "4 hectares 20 kg": "tam_20kg",
    "quero garantir": "preco_comprar",
    "pagamento": "preco_pagamento",
    "outra area": "preco_tamanho",
    "pix": "pag_pix",
    "cartao": "pag_cartao",
    "boleto": "pag_boleto",
    "quero o material": "menu_isca_silagem",
    "agora nao": "menu_isca_nao_silagem",
    "quero saber mais": "f1_sim",
    "so olhando": "f1_olhando",
    "quanto produz": "f1_continuar",
    "leite": "f2_leite",
    "corte": "f2_corte",
    "os dois": "f2_ambos",
    "quero o segredo": "f2_continuar",
    "milho": "f3_milho",
    "capim": "f3_capim",
    "nao planto": "f3_nao",
    "quero ver": "f3_continuar",
    "ja sim": "f4_ja",
    "nunca gracas": "f4_nunca",
    "sim quero": "f5_sim",
    "vou informar": "f5_local",
  };
  return replies[normalized];
}
