// intent — detecção de INTENÇÃO do cliente na entrada (funil Mega Sorgo).
// v1: intenção de PREÇO por três portas: botão (tratado no hub-webhook), TEXTO escrito e
// ÁUDIO (transcrito via Whisper/OpenAI quando OPENAI_API_KEY existir; sem chave, áudio fica
// de fora e as outras portas seguem). Match tolerante a maiúscula/acento.
import { optionalEnv } from "./env.ts";

// minúsculo + sem acentos (NFD separa os diacríticos; regex remove).
export function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// "preço", "valor", "quanto custa/sai/fica/tá/é/vale", "custa", "orçamento", "tabela de preço".
// "tabela" sozinha NÃO conta (colide com "tabela nutricional" do menu).
const PRECO_RE =
  /(\bprecos?\b|\bvalor(es)?\b|\borcamento\b|quanto\s+(custa|sai|fica|ta|vale|e)\b|\bcusta\b|tabela\s+de\s+preco)/;

export function isPrecoIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  return PRECO_RE.test(t);
}

// DÚVIDA TÉCNICA — pergunta de quem está avaliando comprar, mas sobre COMO usar, não sobre
// preço. Vocabulário tirado das mensagens reais do banco (08/08), onde essas perguntas
// chegam digitadas e não casam com nenhum detector: "Qual melhor espaço entre linhas",
// "É melhor plantar ele a lanço ou na linha", "Quantas sementes por hectare", "Meu plantio
// é irrigado com mangueira de gotejo", "E pra quais animais esse mega sorgo serve??".
//
// PLANTIO_RE não cobre: ele exige "como plantar"/"plantio"/"manejo"/"adubação", e nenhuma
// dessas frases tem essas palavras — passavam batido e o funil seguia falando de tonelada.
//
// Não responde nada ao cliente por enquanto: o conteúdo dessas respostas ainda não existe,
// e responder errado sobre espaçamento é pior que não responder. O consumidor avisa o
// atendente. Quando os textos existirem, é aqui que eles entram.
const DUVIDA_TECNICA_RE =
  /(\bespacamento\b|\bespaco\s+entre\s+linhas?\b|\bentre\s+linhas?\b|\ba\s+lanco\b|\bna\s+linha\b|\blanco\s+ou\s+linha\b|\bsementes?\s+por\s+hectare\b|\bquantas\s+sementes\b|\bdensidade\b|\bgotejo\b|\birriga\w*\b|\bmangueira\b|\bpra\s+quais\s+animais\b|\bquais\s+animais\b|\bserve\s+pra\s+(aves|peixes|suino|porco|galinha)\b|\b(aves|peixes|suinos?)\b)/;

export function isDuvidaTecnicaIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  // Preço continua tendo prioridade: "quanto custa a semente por hectare" é pergunta de
  // preço, e a tabela já é resposta pronta. Mesma precedência dos outros detectores.
  if (PRECO_RE.test(t)) return false;
  return DUVIDA_TECNICA_RE.test(t);
}

// Só dispara se a palavra "vídeo" (ou "video", "vídeos", "videos") aparecer na frase.
const VIDEO_RE = /\bvideos?\b/;

export function isVideoIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (PRECO_RE.test(t)) return false;
  return VIDEO_RE.test(t);
}

// "como plantar", "como planta", "plantio", "manejo", "instrução de plantio".
const PLANTIO_RE =
  /(\bcomo\s+planta[r]?\b|\bplantio\b|\bmanejo\b|\binstruc[ao]+\s+de\s+plantio\b|\baduba[cçr]\w*\b|\badubo\b|\bfertiliza[cçr]\w*\b)/;

export function isPlantioIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (PRECO_RE.test(t)) return false;
  return PLANTIO_RE.test(t);
}

// "nutricional", "nutrição", "bromatológica", "análise bromatológica", "composição nutricional", "tabela nutricional".
const NUTRICAO_RE =
  /(\bnutri[cç][aã]o\b|\bnutricional\b|\bbromatol[oó]gica\b|\bcomposi[cç][aã]o\s+nutricional\b|\btabela\s+nutricional\b)/;

export function isNutricaoIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (PRECO_RE.test(t)) return false;
  return NUTRICAO_RE.test(t);
}

// "bom dia", "boa tarde", "boa noite", "olá", "oi", "eai", "e aí", "vida boa", "opa", "hey".
// Saudações genéricas que não casam com nenhum outro intent.
const SAUDACAO_RE =
  /^(\s)*(bom\s+dia|boa\s+(tarde|noite)|ola|oi|eai|e\s+ai|vida\s+boa|opa|hey|hi|hello|pode\s+sim|tudo\s+bem|boa)(\s|[!?,.])*$/;

export function isSaudacaoIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (PRECO_RE.test(t)) return false;
  if (VIDEO_RE.test(t)) return false;
  if (PLANTIO_RE.test(t)) return false;
  if (NUTRICAO_RE.test(t)) return false;
  return SAUDACAO_RE.test(t);
}

// FECHAMENTO — o lead está passando dados para concluir o pedido (CEP, CPF/CNPJ, endereço).
// Serve para PROTEGER a venda: pausa o funil e prioriza o atendimento. NÃO marca como pago —
// quem carimba "pago" é o humano, pela etiqueta, depois de conferir o comprovante.
//
// Cuidado deliberado com falso positivo: CPF e telefone celular têm 11 dígitos. Por isso só
// conta número quando vem FORMATADO (com ponto/traço) ou acompanhado da palavra-chave. Um
// "5511999998888" solto não dispara.
const FECHAMENTO_PALAVRA_RE =
  /(\bcep\b|\bcpf\b|\bcnpj\b|\bendereco\b|\brazao\s+social\b|\bbairro\b|\bnumero\s+da\s+casa\b)/;

// CEP formatado: 12345-678 / 12.345-678. CPF: 123.456.789-01. CNPJ: 12.345.678/0001-90.
const CEP_FMT_RE = /\b\d{2}\.?\d{3}[-\s]\d{3}\b/;
const CPF_FMT_RE = /\b\d{3}\.\d{3}\.\d{3}[-\s]?\d{2}\b/;
const CNPJ_FMT_RE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}[-\s]?\d{2}\b/;

export function isFechamentoIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (FECHAMENTO_PALAVRA_RE.test(t)) return true;
  return CEP_FMT_RE.test(t) || CPF_FMT_RE.test(t) || CNPJ_FMT_RE.test(t);
}

// Documento recebido (PDF de comprovante, normalmente). Trata como fechamento em andamento
// pelo mesmo motivo: prioriza e protege, sem concluir a venda sozinho.
export function isComprovanteMsgType(
  msgType: string | null | undefined,
): boolean {
  return String(msgType ?? "").toLowerCase() === "document";
}

// Transcreve áudio curto via provedor configurado. null se sem chave, áudio grande demais
// ou erro (caller segue sem transcrição — detecção por áudio é best-effort).
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export async function transcribeAudio(
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) return null;
  const provider = (optionalEnv("AUDIO_TRANSCRIBE_PROVIDER") ?? "openai")
    .toLowerCase();
  if (provider === "gemini") {
    const gemini = await transcribeWithGemini(bytes, contentType);
    if (gemini) return gemini;
    return await transcribeWithOpenAI(bytes, contentType);
  }
  return await transcribeWithOpenAI(bytes, contentType);
}

async function transcribeWithGemini(
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const key = optionalEnv("GEMINI_API_KEY") ?? optionalEnv("GOOGLE_API_KEY");
  if (!key) return null;
  const primary = optionalEnv("GEMINI_TRANSCRIBE_MODEL") ?? "gemini-2.5-flash";
  const fallback = optionalEnv("AUDIO_TRANSCRIBE_FALLBACK_MODEL") ??
    "gemini-2.5-flash";
  const models = [...new Set([primary, fallback].filter(Boolean))];
  try {
    const body = JSON.stringify({
      contents: [{
        parts: [
          {
            text:
              "Transcreva literalmente este áudio em português do Brasil. Responda somente com a transcrição, sem comentários, aspas ou formatação.",
          },
          {
            inline_data: {
              mime_type: normalizedAudioMime(contentType),
              data: bytesToBase64(bytes),
            },
          },
        ],
      }],
      generationConfig: { temperature: 0 },
    });

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(model)
      }:generateContent?key=${encodeURIComponent(key)}`;
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) {
          const detail = (await res.text()).slice(0, 180);
          const retryable = res.status === 429 || res.status >= 500;
          console.warn(
            "gemini transcrição falhou:",
            res.status,
            `tentativa ${attempt}/3`,
            detail,
          );
          if (!retryable || attempt === 3) break;
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        const json = await res.json().catch(() => ({})) as Record<
          string,
          unknown
        >;
        const candidates = json.candidates as
          | Array<Record<string, unknown>>
          | undefined;
        const content = candidates?.[0]?.content as
          | Record<string, unknown>
          | undefined;
        const parts = content?.parts as
          | Array<Record<string, unknown>>
          | undefined;
        return parts?.map((part) =>
          typeof part.text === "string" ? part.text : ""
        )
          .join(" ").trim() || null;
      }
    }
    return null;
  } catch (e) {
    console.warn("gemini transcrição erro:", String(e).slice(0, 140));
    return null;
  }
}

async function transcribeWithOpenAI(
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const key = optionalEnv("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const ext = contentType.includes("ogg")
      ? "ogg"
      : contentType.includes("mp4")
      ? "m4a"
      : contentType.includes("mpeg")
      ? "mp3"
      : "ogg";
    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("language", "pt");
    form.append(
      "file",
      new Blob([
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer,
      ], { type: contentType }),
      `audio.${ext}`,
    );
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      console.warn(
        "whisper falhou:",
        res.status,
        (await res.text()).slice(0, 150),
      );
      return null;
    }
    const j = await res.json().catch(() => ({}));
    return (j.text as string | undefined)?.trim() || null;
  } catch (e) {
    console.warn("whisper erro:", String(e).slice(0, 120));
    return null;
  }
}

function normalizedAudioMime(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim() || "audio/ogg";
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }
  return btoa(binary);
}
