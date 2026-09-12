// midia-funil — a peça do funil aponta para um arquivo que ainda existe?
//
// Em 08/09 a biblioteca do funil foi apagada do storage: 24 dos 64 arquivos ativos de
// `funnel_media` respondem HTTP 400 (cards de preço, capa, logo, plantio, produção,
// logística, CEP, imagens de recuperação, 2 PDFs e os 5 vídeos). Desde então:
//
//  - a Meta recusa a peça inteira ("(#100) Ocorreu um erro ao carregar o anexo",
//    "Upload attachment failure") — 73 falhas em 7 dias;
//  - no Facebook e no Instagram a legenda saía DUAS vezes, porque o anexo falhava e o
//    fallback mandava de novo o texto que já tinha saído;
//  - 110 etapas da fila apontavam para arquivo inexistente, 55 delas marcadas como enviadas.
//
// Enquanto os arquivos não voltam, é melhor entregar o texto do que perder a etapa. Quando
// voltarem, esta checagem passa a dar "existe" e nada mais muda.

type Json = Record<string, unknown>;

/** Cache curto: a mesma peça sai para muitos contatos seguidos. */
const TTL_EXISTE_MS = 10 * 60_000;
const TTL_SUMIU_MS = 5 * 60_000;
const TIMEOUT_MS = 8_000;

const cache = new Map<string, { existe: boolean; ate: number }>();

/** Só para teste: limpa o cache entre casos. */
export function limparCacheMidia(): void {
  cache.clear();
}

/**
 * O arquivo responde? Falha de rede responde `true` de propósito: deixar de mandar a peça
 * porque o nosso próprio HEAD oscilou seria pior que tentar e a Meta recusar.
 */
export async function midiaDisponivel(
  url: string,
  now = Date.now(),
  buscar: (u: string) => Promise<number> = async (u) => {
    const r = await fetch(u, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return r.status;
  },
): Promise<boolean> {
  const alvo = String(url ?? "").trim();
  if (!alvo) return false;
  const guardado = cache.get(alvo);
  if (guardado && guardado.ate > now) return guardado.existe;
  let existe = true;
  try {
    const status = await buscar(alvo);
    // 2xx e 3xx valem; 4xx é arquivo que não está lá. 5xx é problema do storage, não do
    // arquivo — não vale marcar a peça como perdida por causa disso.
    existe = status < 400 || status >= 500;
  } catch {
    existe = true;
  }
  cache.set(alvo, {
    existe,
    ate: now + (existe ? TTL_EXISTE_MS : TTL_SUMIU_MS),
  });
  return existe;
}

export type AcaoSemMidia =
  | { acao: "texto"; conteudo: string }
  | { acao: "pular" }
  | { acao: "sem-header" };

/**
 * O que fazer com a peça quando o arquivo não existe mais. Pura: é a regra que decide o que
 * o cliente recebe.
 */
export function decidirSemMidia(
  type: string,
  payload: Json,
): AcaoSemMidia | null {
  if (type === "image" || type === "video") {
    const legenda = String(payload.caption ?? "").trim();
    // Sem legenda não sobra mensagem nenhuma: pular é melhor que mandar "[image]".
    return legenda ? { acao: "texto", conteudo: legenda } : { acao: "pular" };
  }
  if (type === "audio") return { acao: "pular" };
  // Botão com imagem no topo: os botões são o que importa, a imagem é enfeite.
  if (type === "interactive" && String(payload.header_image ?? "").trim()) {
    return { acao: "sem-header" };
  }
  return null;
}

/** URL que a peça usa, se usa alguma. */
export function urlDaPeca(type: string, payload: Json): string | null {
  if (type === "image" || type === "video" || type === "audio") {
    return String(payload.media_url ?? "").trim() || null;
  }
  if (type === "interactive") {
    return String(payload.header_image ?? "").trim() || null;
  }
  return null;
}
