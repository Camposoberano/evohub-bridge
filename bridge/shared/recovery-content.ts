export type RecoveryPiece = {
  type: "interactive" | "video" | "audio";
  payload: Record<string, unknown>;
};

export type RecoveryMedia = {
  image?: string;
  video?: string;
  audio?: string;
};

export const RECOVERY_ACTIONS = [
  "recuperacao-1",
  "recuperacao-2",
  "recuperacao-3",
  "recuperacao-4",
] as const;

export function recoveryPieces(
  variation: number,
  media: RecoveryMedia,
): RecoveryPiece[] {
  if (variation === 1) {
    return [{
      type: "interactive",
      payload: {
        text:
          "Oi! O senhor conseguiu olhar as informações do Mega Sorgo? Separei os pontos que mais ajudam o produtor a decidir. O que seria mais útil agora?",
        buttons: [
          { id: "menu_preco", title: "Ver preço 💰" },
          { id: "menu_plantio", title: "Como plantar 🌱" },
          { id: "menu_humano", title: "Falar com Cícero" },
        ],
        ...(media.image ? { header_image: media.image } : {}),
      },
    }];
  }

  if (variation === 2) {
    const pieces: RecoveryPiece[] = [];
    if (media.video) {
      pieces.push({
        type: "video",
        payload: {
          media_url: media.video,
          caption:
            "Separei este vídeo curto porque resultado no campo explica melhor do que promessa. Veja a produção e depois me diga o que achou.",
        },
      });
    }
    pieces.push({
      type: "interactive",
      payload: {
        text:
          "Qual informação falta para o senhor avaliar se compensa na sua propriedade?",
        buttons: [
          { id: "menu_preco", title: "Calcular preço 💰" },
          { id: "menu_plantio", title: "Como plantar 🌱" },
          { id: "menu_humano", title: "Tirar uma dúvida" },
        ],
      },
    });
    return pieces;
  }

  if (variation === 3) {
    const pieces: RecoveryPiece[] = [];
    if (media.audio) {
      pieces.push({ type: "audio", payload: { media_url: media.audio } });
    }
    pieces.push({
      type: "interactive",
      payload: {
        text:
          "Mandei esse áudio porque seca, custo e qualidade da silagem são as dúvidas que mais aparecem. Qual ponto pesa mais para o senhor?",
        buttons: [
          { id: "menu_nutricao", title: "Nutrição 🧪" },
          { id: "menu_plantio", title: "Plantio 🌱" },
          { id: "menu_humano", title: "Falar com Cícero" },
        ],
      },
    });
    return pieces;
  }

  if (variation === 4) {
    return [{
      type: "interactive",
      payload: {
        text:
          "Antes de encerrar por aqui: ainda faz sentido avaliar o Mega Sorgo para a sua próxima área? Posso calcular a quantidade de sementes ou responder sua dúvida sem compromisso.",
        buttons: [
          { id: "menu_preco", title: "Calcular minha área" },
          { id: "menu_humano", title: "Tenho interesse" },
          { id: "menu_nutricao", title: "Ver nutrição 🧪" },
        ],
        ...(media.image ? { header_image: media.image } : {}),
      },
    }];
  }

  throw new Error(`variação de recuperação inválida: ${variation}`);
}
