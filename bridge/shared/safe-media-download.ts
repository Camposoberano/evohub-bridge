import { avaliarDestino, ehIpInterno } from "./destino-seguro.ts";

const MAX_REDIRECTS = 5;
export const MAX_MEDIA_BYTES = 30 * 1024 * 1024;

async function assertPublicDestination(rawUrl: string): Promise<void> {
  const verdict = avaliarDestino(rawUrl, []);
  if (!verdict.ok) {
    throw new Error(`destino de mídia recusado: ${verdict.motivo}`);
  }
  const host = verdict.host;
  // IP literal já foi avaliado por avaliarDestino. DNS que falha não pode liberar
  // um host cujo endereço real o bridge não conhece.
  if (/^[\d.]+$/.test(host) || host.includes(":")) return;
  const addresses = await Promise.all(["A", "AAAA"].map(async (type) => {
    try {
      return await Deno.resolveDns(host, type as "A" | "AAAA");
    } catch (error) {
      // Um domínio público pode não ter uma das famílias; a outra precisa existir.
      if (error instanceof Deno.errors.NotFound) return [];
      throw error;
    }
  }));
  const all = addresses.flat();
  if (!all.length || all.some(ehIpInterno)) {
    throw new Error(
      `destino de mídia recusado: DNS ausente ou interno para ${host}`,
    );
  }
}

/** Cada redirect é validado antes da próxima requisição. Nunca segue automaticamente. */
export async function fetchSafeMedia(
  sourceUrl: string,
  fetchImpl: typeof fetch = fetch,
  validate: (url: string) => Promise<void> = assertPublicDestination,
): Promise<Response> {
  let current = sourceUrl;
  const signal = AbortSignal.timeout(30_000);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await validate(current);
    const response = await fetchImpl(current, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || hop === MAX_REDIRECTS) {
      throw new Error("redirecionamento de mídia inválido");
    }
    current = new URL(location, current).toString();
  }
  throw new Error("redirecionamentos de mídia em excesso");
}

/** Limita bytes durante a leitura, mesmo quando Content-Length está ausente ou incorreto. */
export async function readLimitedMedia(
  response: Response,
  maxBytes = MAX_MEDIA_BYTES,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error(`mídia excede ${maxBytes} bytes`);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`mídia excede ${maxBytes} bytes`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
