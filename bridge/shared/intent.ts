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
const PRECO_RE = /(\bprecos?\b|\bvalor(es)?\b|\borcamento\b|quanto\s+(custa|sai|fica|ta|vale|e)\b|\bcusta\b|tabela\s+de\s+preco)/;

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
const PLANTIO_RE = /(\bcomo\s+planta[r]?\b|\bplantio\b|\bmanejo\b|\binstruc[ao]+\s+de\s+plantio\b)/;

export function isPlantioIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (PRECO_RE.test(t)) return false;
  return PLANTIO_RE.test(t);
}

// "nutricional", "nutrição", "bromatológica", "análise bromatológica", "composição nutricional", "tabela nutricional".
const NUTRICAO_RE = /(\bnutri[cç][aã]o\b|\bnutricional\b|\bbromatol[oó]gica\b|\bcomposi[cç][aã]o\s+nutricional\b|\btabela\s+nutricional\b)/;

export function isNutricaoIntent(text: string): boolean {
  const t = fold(text ?? "");
  if (!t.trim()) return false;
  if (PRECO_RE.test(t)) return false;
  return NUTRICAO_RE.test(t);
}

// Transcreve áudio curto via OpenAI Whisper. null se sem chave, áudio grande demais ou erro
// (caller segue sem transcrição — detecção por áudio é best-effort).
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export async function transcribeAudio(bytes: Uint8Array, contentType: string): Promise<string | null> {
  const key = optionalEnv("OPENAI_API_KEY");
  if (!key || bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) return null;
  try {
    const ext = contentType.includes("ogg") ? "ogg" : contentType.includes("mp4") ? "m4a" : contentType.includes("mpeg") ? "mp3" : "ogg";
    const form = new FormData();
    form.set("model", "whisper-1");
    form.set("language", "pt");
    form.append("file", new Blob([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], { type: contentType }), `audio.${ext}`);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) { console.warn("whisper falhou:", res.status, (await res.text()).slice(0, 150)); return null; }
    const j = await res.json().catch(() => ({}));
    return (j.text as string | undefined)?.trim() || null;
  } catch (e) {
    console.warn("whisper erro:", String(e).slice(0, 120));
    return null;
  }
}
