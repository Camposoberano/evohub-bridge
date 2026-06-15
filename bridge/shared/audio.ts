// audio — converte áudio de saída pra OGG/Opus pra virar "voz gravada" (PTT) no WhatsApp.
// Cloud API só renderiza bolha de voz quando o arquivo é audio/ogg (opus); mp3/m4a viram player de arquivo.
// Fluxo: baixa o arquivo -> ffmpeg -> ogg/opus -> sobe em bucket público -> devolve URL pública.
import { admin } from "./supabase.ts";

const BUCKET = "soberano-out"; // público; mídia gerada pelo bridge (PTT)

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await (admin() as any).storage.createBucket(BUCKET, { public: true });
  // "already exists" não é erro real; qualquer outro loga mas segue (bucket pode já existir).
  if (error && !/exist/i.test(error.message ?? "")) console.warn("createBucket soberano-out:", error.message);
  bucketReady = true;
}

// Devolve URL pública de um .ogg/opus, ou null se falhar (caller usa o original).
export async function toVoiceOgg(srcUrl: string): Promise<string | null> {
  if (/\.(ogg|oga)(\?|$)/i.test(srcUrl)) return srcUrl; // já é ogg -> nada a fazer
  let inPath = "", outPath = "";
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) return null;
    const input = new Uint8Array(await res.arrayBuffer());
    inPath = await Deno.makeTempFile({ suffix: ".bin" });
    outPath = await Deno.makeTempFile({ suffix: ".ogg" });
    await Deno.writeFile(inPath, input);
    const cmd = new Deno.Command("ffmpeg", {
      args: ["-y", "-i", inPath, "-vn", "-c:a", "libopus", "-b:a", "32k", "-ar", "48000", "-ac", "1", outPath],
      stderr: "null", stdout: "null",
    });
    const { success } = await cmd.output();
    if (!success) { console.error("ffmpeg falhou ao transcodificar áudio"); return null; }
    const bytes = await Deno.readFile(outPath);
    if (bytes.length === 0) return null;

    await ensureBucket();
    const path = `ptt/${crypto.randomUUID()}.ogg`;
    const { error } = await (admin() as any).storage.from(BUCKET).upload(
      path, new Blob([bytes], { type: "audio/ogg" }),
      { contentType: "audio/ogg", upsert: false },
    );
    if (error) { console.error("upload ogg falhou:", error.message); return null; }
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
