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
