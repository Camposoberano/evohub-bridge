// keyword-listeners — casa a mensagem de entrada com uma campanha "modo palavra-chave" e inicia
// o fluxo dela. Portado do hub CECAPE. Puro: as mesmas regras valem ao registrar e ao receber.

type KeywordCampaign = {
  id: string;
  channelId?: string;
  flow?: unknown;
  keywords?: string[];
};

/** Normaliza texto pra casar palavra: minúsculo, sem acento, só letras/dígitos. */
export function normalizarTexto(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function casaPalavra(msgNorm: string, keywordCru: string): boolean {
  const kw = normalizarTexto(keywordCru);
  return Boolean(kw) && ` ${msgNorm} `.includes(` ${kw} `);
}

/** Listeners legados sem channelId são deliberadamente inertes. */
export function escolherListener<T extends KeywordCampaign>(
  campaigns: T[],
  channelId: string,
  texto: string,
): T | null {
  const normalized = normalizarTexto(texto);
  if (!normalized || !channelId) return null;
  return campaigns.find((c) =>
    c.channelId === channelId &&
    c.flow &&
    c.keywords?.some((keyword) => casaPalavra(normalized, keyword))
  ) ?? null;
}

export function conflitoPalavra(
  campaigns: KeywordCampaign[],
  channelId: string,
  keywords: string[],
): { campaignId: string; keyword: string } | null {
  const requested = new Set(keywords.map(normalizarTexto).filter(Boolean));
  for (const campaign of campaigns) {
    if (campaign.channelId !== channelId || !campaign.keywords?.length) continue;
    for (const keyword of campaign.keywords) {
      if (requested.has(normalizarTexto(keyword))) {
        return { campaignId: campaign.id, keyword };
      }
    }
  }
  return null;
}
