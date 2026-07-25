// hybrid-list — payload de lista interativa (type:"list") do uazapi /send/menu.
// Formato confirmado na doc oficial (openapi-bundled.json, operationId sendMenu):
//   choices: ["[Título da Seção]", "texto|id|descrição", ...]
//   "[Título]" abre uma seção nova; toda entrada seguinte pertence a ela até a próxima "[Título]".
//   "texto|id|descrição" — id e descrição são opcionais (id vira igual ao texto se omitido).
export type HybridListRow = {
  id: string;
  title: string;
  description?: string;
};

export type HybridListSection = {
  title: string;
  rows: HybridListRow[];
};

// WhatsApp (Meta) limita listas a 10 linhas por seção — vale pro transporte uazapi também.
export const MAX_ROWS_PER_SECTION = 10;

function escapeChoice(value: string): string {
  // "|" e quebra de linha quebram o parser de choices do uazapi; nunca deveriam aparecer
  // em título/id/descrição de produto, mas normaliza defensivamente.
  return value.replace(/\|/g, "/").replace(/\r?\n/g, " ").trim();
}

export function buildHybridListPayload(
  to: string,
  text: string,
  sections: HybridListSection[],
  buttonLabel: string,
  footerText?: string,
): Record<string, unknown> {
  const choices: string[] = [];
  for (const section of sections) {
    choices.push(`[${escapeChoice(section.title)}]`);
    for (const row of section.rows.slice(0, MAX_ROWS_PER_SECTION)) {
      const parts = [escapeChoice(row.title), escapeChoice(row.id)];
      if (row.description) parts.push(escapeChoice(row.description));
      choices.push(parts.join("|"));
    }
  }
  return {
    number: to,
    type: "list",
    text,
    choices,
    listButton: buttonLabel,
    footerText: footerText || undefined,
    readchat: true,
    delay: 0,
  };
}

// Fallback textual pra clientes/versões que não renderizam a lista nativa.
export function buildHybridListFallback(
  text: string,
  sections: HybridListSection[],
): string {
  const lines = [text, ""];
  for (const section of sections) {
    lines.push(`*${section.title}*`);
    for (const row of section.rows) lines.push(`- ${row.title}`);
    lines.push("");
  }
  lines.push("Responda com o nome da opção desejada.");
  return lines.join("\n").trim();
}

// Pagina uma lista de linhas em seções de até MAX_ROWS_PER_SECTION, adicionando uma linha
// "mais opções..." (id "<pageIdPrefix>_more_<offset>") quando sobra próxima página.
export function paginateRows(
  rows: HybridListRow[],
  page: number,
  pageIdPrefix: string,
): { rows: HybridListRow[]; hasMore: boolean } {
  // Cabe tudo numa página só — não gasta slot com "mais opções".
  if (rows.length <= MAX_ROWS_PER_SECTION) {
    return { rows: page === 0 ? rows : [], hasMore: false };
  }
  const capacity = MAX_ROWS_PER_SECTION - 1; // reserva 1 slot pra "mais opções"
  const start = page * capacity;
  const slice = rows.slice(start, start + capacity);
  const hasMore = start + capacity < rows.length;
  const paged = [...slice];
  if (hasMore) {
    paged.push({
      id: `${pageIdPrefix}_more_${page + 1}`,
      title: "➡️ Mais opções",
    });
  }
  return { rows: paged, hasMore };
}
