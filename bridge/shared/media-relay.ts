import { admin } from "./supabase.ts";

const BUCKET = "soberano-relay";
const MAX_BYTES = 30 * 1024 * 1024;
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const REMOVE_AFTER_MS = 20 * 60_000;
let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await (admin() as any).storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_BYTES,
  });
  if (error && !/exist/i.test(error.message ?? "")) {
    throw new Error(`media relay bucket: ${error.message}`);
  }
  bucketReady = true;
}

export async function relayProviderMedia(
  sourceUrl: string,
  fallbackName = "arquivo",
): Promise<string> {
  const response = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`download da mídia retornou HTTP ${response.status}`);
  }

  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (declaredSize > MAX_BYTES) {
    throw new Error(`mídia excede ${MAX_BYTES / 1024 / 1024} MB`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("mídia vazia");
  if (bytes.length > MAX_BYTES) {
    throw new Error(`mídia excede ${MAX_BYTES / 1024 / 1024} MB`);
  }

  await ensureBucket();
  const contentType = response.headers.get("content-type")?.split(";")[0] ||
    "application/octet-stream";
  const extension = safeExtension(fallbackName) || extensionFor(contentType);
  const path = `relay/${
    new Date().toISOString().slice(0, 10)
  }/${crypto.randomUUID()}${extension}`;
  const { error } = await (admin() as any).storage.from(BUCKET).upload(
    path,
    new Blob([bytes], { type: contentType }),
    { contentType, upsert: false },
  );
  if (error) throw new Error(`upload da mídia: ${error.message}`);
  const storage = (admin() as any).storage.from(BUCKET);
  const { data, error: signedError } = await storage.createSignedUrl(
    path,
    SIGNED_URL_TTL_SECONDS,
  );
  if (signedError || !data?.signedUrl) {
    await storage.remove([path]).catch(() => {});
    throw new Error(
      `URL assinada da mídia: ${signedError?.message ?? "ausente"}`,
    );
  }
  scheduleRemoval(path);
  return data.signedUrl as string;
}

function scheduleRemoval(path: string) {
  const timer = setTimeout(async () => {
    const { error } = await (admin() as any).storage.from(BUCKET).remove([
      path,
    ]);
    if (error) console.warn("limpeza do media relay falhou:", error.message);
  }, REMOVE_AFTER_MS);
  Deno.unrefTimer(timer);
}

function safeExtension(name: string): string {
  const match = name.toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return match?.[1] ?? "";
}

function extensionFor(contentType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "video/mp4": ".mp4",
    "application/pdf": ".pdf",
  };
  return extensions[contentType] ?? "";
}
