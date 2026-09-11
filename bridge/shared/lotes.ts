// lotes — consulta por lista de ids sem estourar o tamanho da URL.
//
// O PostgREST põe o `.in()` na query string. 500 uuids passam de 18 KB e o nginx do Supabase
// devolve `414 Request-URI Too Large` — em 11/09 isso derrubava o loop funnel-recovery a
// cada rodada (via mutedConversationIds). 100 uuids ficam em ~3,7 KB.
//
// E erro de lote NUNCA vira lista vazia: "nenhuma sequência encontrada" faria conversa já
// inscrita parecer elegível de novo.

export const LOTE_IDS = 100;

export function emLotes<T>(itens: T[], tamanho = LOTE_IDS): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** Roda `consulta` em lotes de ids (sem repetidos nem vazios) e junta as linhas. */
export async function consultaEmLotes<T>(
  ids: unknown[],
  consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tamanho = LOTE_IDS,
): Promise<T[]> {
  const unicos = [...new Set(ids.filter((id) => id != null && id !== "").map(String))];
  const linhas: T[] = [];
  for (const lote of emLotes(unicos, tamanho)) {
    const { data, error } = await consulta(lote);
    if (error) throw error;
    linhas.push(...(data ?? []));
  }
  return linhas;
}
