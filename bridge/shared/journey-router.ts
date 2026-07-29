export type JourneyDomain = "catalogo" | "mega_sorgo" | null;

const CATALOG_PREFIXES = [
  "grp_",
  "cat_",
  "prod_",
  "acao_",
  "pg_",
  "quali_obj_",
] as const;

const MEGA_SORGO_PREFIXES = [
  "menu_",
  "preco_",
  "tam_",
  "pag_",
  "plantio_",
  "nutricao_",
] as const;

export function clickDomain(id: string): JourneyDomain {
  if (CATALOG_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return "catalogo";
  }
  if (MEGA_SORGO_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return "mega_sorgo";
  }
  return null;
}

export function canRouteClick(
  activeJourney: "catalogo" | "mega_sorgo",
  id: string,
): boolean {
  const domain = clickDomain(id);
  return domain === null || domain === activeJourney;
}

export function directInstanceCandidates(
  name: unknown,
  externalId: unknown,
): string[] {
  const candidates = [name, externalId]
    .filter((value): value is string =>
      typeof value === "string" && value.trim().length > 0
    )
    .map((value) => value.trim());
  return [...new Set(candidates)];
}

export function catalogTextClaimKey(input: {
  channelId: string;
  from: string;
  metaMessageId?: string | null;
  sentAt?: string | null;
  content?: string | null;
}): string {
  const eventId = input.metaMessageId?.trim() ||
    `${input.sentAt ?? "sem-data"}-${input.content ?? ""}`.slice(0, 180);
  return `catalog-text-${input.channelId}-${input.from}-${eventId}`;
}
