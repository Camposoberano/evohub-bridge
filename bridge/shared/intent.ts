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
