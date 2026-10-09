/** Respostas dos botões históricos de 30/09. Nenhuma antecipa uma fase agendada. */
export type RestoredButtonAction =
  | { kind: "text"; content: string }
  | { kind: "route"; menuId: "menu_preco" };

const ACTIONS: Record<string, RestoredButtonAction> = {
  f1_sim: {
    kind: "text",
    content:
      "Ótimo! Vou lhe apresentar o Mega Sorgo Santa Elisa nas próximas mensagens. Se quiser saber o preço antes, escolha Preço no menu.",
  },
  f1_olhando: {
    kind: "text",
    content:
      "Sem problema! Vou lhe mostrar o material para o senhor conhecer com calma.",
  },
  f1_continuar: {
    kind: "text",
    content:
      "Na próxima etapa vou lhe mostrar a informação sobre produção por hectare.",
  },
  f2_leite: {
    kind: "text",
    content: "Entendi, o seu foco é gado de leite. Obrigado por me contar.",
  },
  f2_corte: {
    kind: "text",
    content: "Entendi, o seu foco é gado de corte. Obrigado por me contar.",
  },
  f2_ambos: {
    kind: "text",
    content:
      "Entendi, o senhor trabalha com leite e corte. Obrigado por me contar.",
  },
  f2_continuar: {
    kind: "text",
    content: "Na próxima etapa vou lhe mostrar como funciona a rebrota.",
  },
  f3_milho: {
    kind: "text",
    content: "Entendi, hoje o senhor planta milho para silagem.",
  },
  f3_capim: {
    kind: "text",
    content: "Entendi, hoje o senhor planta capim para silagem.",
  },
  f3_nao: {
    kind: "text",
    content: "Entendi, o senhor ainda não planta para silagem.",
  },
  f3_continuar: {
    kind: "text",
    content: "Na próxima etapa vou falar sobre pragas e seca.",
  },
  f4_ja: {
    kind: "text",
    content:
      "Sinto muito por essa perda. Vou lhe mostrar o material sobre pragas e seca.",
  },
  f4_nunca: {
    kind: "text",
    content: "Que bom! Vou lhe mostrar o material sobre pragas e seca.",
  },
  f4_continuar: {
    kind: "text",
    content:
      "Se quiser uma cotação, toque em Preço no menu. A apresentação também continua por aqui.",
  },
  f5_sim: { kind: "route", menuId: "menu_preco" },
  f5_local: {
    kind: "text",
    content:
      "Pode me informar sua cidade e estado, ou o CEP? O Cícero confirma o prazo para sua região.",
  },
};

export function restoredButtonAction(id: string): RestoredButtonAction | null {
  return ACTIONS[id] ?? null;
}

export function isRestoredFunnelButton(id: string): boolean {
  return restoredButtonAction(id) !== null;
}

export const RESTORED_BUTTON_IDS = Object.keys(ACTIONS);
