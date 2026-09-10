// audio — converte áudio de saída pra OGG/Opus pra virar "voz gravada" (PTT) no WhatsApp.
// Cloud API só renderiza bolha de voz quando o arquivo é audio/ogg (opus); mp3/m4a viram player de arquivo.
// Fluxo: baixa o arquivo -> ffmpeg -> ogg/opus -> sobe em bucket público -> devolve URL pública.
import { admin } from "./supabase.ts";

const BUCKET = "soberano-out"; // público; mídia gerada pelo bridge (PTT)

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await (admin() as any).storage.createBucket(BUCKET, {
    public: true,
  });
  // "already exists" não é erro real; qualquer outro loga mas segue (bucket pode já existir).
  if (error && !/exist/i.test(error.message ?? "")) {
    console.warn("createBucket soberano-out:", error.message);
  }
  bucketReady = true;
}

/**
 * Caminho estável derivado do conteúdo do áudio: mesmo áudio, mesmo objeto no bucket.
 *
 * É o que transforma "sobe uma cópia por envio" em "sobe uma vez e reaproveita". SHA-256
 * porque colisão aqui serviria um áudio errado para o cliente.
 */
export async function caminhoDoAudio(bytes: Uint8Array): Promise<string> {
  // cópia própria: o Uint8Array que chega pode estar sobre SharedArrayBuffer, que o
  // crypto.subtle não aceita.
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `ptt/${hex}.ogg`;
}

/**
 * Upload que bate em objeto já existente é SUCESSO, não falha — é exatamente o
 * reaproveitamento. Tratar como erro faria o áudio deixar de ser enviado a partir da
 * segunda vez, que é o caso comum.
 */
export function ehObjetoJaExistente(
  error: { message?: string; statusCode?: string | number } | null | undefined,
): boolean {
  if (!error) return false;
  if (String(error.statusCode ?? "") === "409") return true;
  return /already exists|duplicate|resource already/i.test(
    String(error.message ?? ""),
  );
}

// Devolve URL pública de um .ogg/opus, ou null se falhar (caller usa o original).
export async function toVoiceOgg(srcUrl: string): Promise<string | null> {
  // SEMPRE transcodifica pra ogg/opus. (Não pula .ogg: o Chatwoot serve ogg/vorbis,
  // que o WhatsApp mostra como ARQUIVO, não como voz/PTT — só opus vira bolha de voz.)
  let inPath = "", outPath = "";
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) return null;
    const input = new Uint8Array(await res.arrayBuffer());
    inPath = await Deno.makeTempFile({ suffix: ".bin" });
    outPath = await Deno.makeTempFile({ suffix: ".ogg" });
    await Deno.writeFile(inPath, input);
    // A imagem Deno traz /usr/local/lib/libgcc_s.so.1 incompatível que sombreia o do sistema
    // e quebra o ffmpeg (exit 127). Força /usr/lib primeiro p/ pegar o libgcc certo da alpine.
    const cmd = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-i",
        inPath,
        "-vn",
        "-c:a",
        "libopus",
        "-b:a",
        "64k",
        "-ar",
        "48000",
        "-ac",
        "1",
        "-application",
        "voip",
        outPath,
      ],
      env: { LD_LIBRARY_PATH: "/usr/lib:/lib" },
      stderr: "piped",
      stdout: "null",
    });
    const { success, code, stderr } = await cmd.output();
    if (!success) {
      console.error(
        `ffmpeg falhou (code ${code}):`,
        new TextDecoder().decode(stderr).slice(0, 300),
      );
      return null;
    }
    const bytes = await Deno.readFile(outPath);
    if (bytes.length === 0) return null;

    await ensureBucket();
    // Nome derivado do CONTEÚDO, não sorteado. O funil manda os mesmos áudios para todo
    // lead, e o randomUUID subia um arquivo novo a cada envio: 43 áudios distintos viraram
    // 9.552 objetos e 4,59 GB de cópia em três meses -- um único áudio de 1 MB tinha 907
    // cópias. Com o hash, o segundo envio do mesmo áudio reaproveita o objeto existente.
    const path = await caminhoDoAudio(bytes);
    const { error } = await (admin() as any).storage.from(BUCKET).upload(
      path,
      new Blob([bytes], { type: "audio/ogg" }),
      { contentType: "audio/ogg", upsert: false },
    );
    // Colisão aqui não é falha: é o reaproveitamento acontecendo. Só erro de verdade aborta.
    if (error && !ehObjetoJaExistente(error)) {
      console.error("upload ogg falhou:", error.message);
      return null;
    }
    const { data } = (admin() as any).storage.from(BUCKET).getPublicUrl(path);
    return (data?.publicUrl as string) ?? null;
  } catch (e) {
    console.error("toVoiceOgg erro:", String(e).slice(0, 200));
    return null;
  } finally {
    if (inPath) await Deno.remove(inPath).catch(() => {});
    if (outPath) await Deno.remove(outPath).catch(() => {});
  }
}

/**
 * Áudio para Facebook e Instagram: m4a/AAC.
 *
 * Os áudios do funil são ogg/opus — formato nativo do WhatsApp, que é onde nasceram. A Meta
 * **não aceita ogg como áudio** nos canais sociais. A documentação dela lista:
 *
 *   Áudio  aac, m4a, wav, mp4  (25 MB)     Vídeo  mp4, ogg, avi, mov, webm
 *
 * O ogg aparece em VÍDEO, não em áudio. E **mp3 não aparece em nenhum dos dois** — esta
 * função convertia para mp3 e continuava falhando, com `IGApiException: Upload attachment
 * failure` (subcode 2018047). O bridge então caía num fallback que mandava a URL como texto:
 * em 10/09, 100% dos áudios do Instagram chegaram ao cliente como link em vez de som. No
 * Facebook o mesmo ogg falhava de forma intermitente.
 *
 * AAC em contêiner m4a está na lista dos dois canais. Devolve null em caso de falha, e aí o
 * chamador segue com o original.
 */
export async function toSocialAudio(srcUrl: string): Promise<string | null> {
  let inPath = "", outPath = "";
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) return null;
    const input = new Uint8Array(await res.arrayBuffer());
    inPath = await Deno.makeTempFile({ suffix: ".bin" });
    outPath = await Deno.makeTempFile({ suffix: ".m4a" });
    await Deno.writeFile(inPath, input);
    const cmd = new Deno.Command("ffmpeg", {
      args: [
        "-y",
        "-i",
        inPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-ar",
        "44100",
        "-ac",
        "1",
        outPath,
      ],
      env: { LD_LIBRARY_PATH: "/usr/lib:/lib" },
      stderr: "piped",
      stdout: "null",
    });
    const { success, code, stderr } = await cmd.output();
    if (!success) {
      console.error(
        `ffmpeg m4a falhou (code ${code}):`,
        new TextDecoder().decode(stderr).slice(0, 300),
      );
      return null;
    }
    const bytes = await Deno.readFile(outPath);
    if (bytes.length === 0) return null;

    await ensureBucket();
    // Nome pelo conteúdo, mesma razão do PTT: o funil manda o mesmo áudio para todo lead, e
    // o randomUUID daqui criava uma cópia por envio.
    const path = (await caminhoDoAudio(bytes)).replace(/^ptt\//, "social-audio/")
      .replace(/\.ogg$/, ".m4a");
    const { error } = await (admin() as any).storage.from(BUCKET).upload(
      path,
      new Blob([bytes], { type: "audio/mp4" }),
      { contentType: "audio/mp4", upsert: false },
    );
    // Colisão = o mesmo áudio já convertido antes. É reaproveitamento, não falha.
    if (error && !ehObjetoJaExistente(error)) {
      console.error("upload m4a falhou:", error.message);
      return null;
    }
    const { data } = (admin() as any).storage.from(BUCKET).getPublicUrl(path);
    return (data?.publicUrl as string) ?? null;
  } catch (error) {
    console.error("toSocialMp3 erro:", String(error).slice(0, 200));
    return null;
  } finally {
    if (inPath) await Deno.remove(inPath).catch(() => {});
    if (outPath) await Deno.remove(outPath).catch(() => {});
  }
}
