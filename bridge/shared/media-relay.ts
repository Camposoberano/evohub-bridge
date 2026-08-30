import { admin } from "./supabase.ts";
import { optionalEnv } from "./env.ts";
import { avaliarDestino, ehIpInterno } from "./destino-seguro.ts";

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

// O webhook do Chatwoot chega antes do anexo estar servível pelo ActiveStorage: a primeira
// leitura devolve 404 e segundos depois a mesma URL responde 200. Em 28/08 isso derrubou 17
// envios de mídia em rajada, e no dia seguinte todas as URLs daquelas mensagens abriam
// normalmente. Tentar de novo resolve; falhar na primeira tentativa perde o envio.
const RELAY_RETRY_DELAYS_MS = [1_000, 3_000, 8_000];

// Host do Chatwoot: é de lá que vem o data_url do anexo. Serve só para distinguir o
// esperado do inesperado no log — host público fora dessa lista continua passando.
function hostsEsperados(): string[] {
  const cw = optionalEnv("CHATWOOT_URL") ?? "";
  try {
    return cw ? [new URL(cw).hostname] : [];
  } catch {
    return [];
  }
}

// Nome público que RESOLVE para IP interno é o contorno clássico do bloqueio por host.
// Se a resolução falhar, deixamos passar: o fetch a seguir falharia de qualquer forma, e
// derrubar mídia legítima por um hiccup de DNS sairia mais caro que o risco residual.
async function resolveParaRedeInterna(host: string): Promise<boolean> {
  try {
    const enderecos = await Deno.resolveDns(host, "A");
    return enderecos.some((ip) => ehIpInterno(ip));
  } catch {
    return false;
  }
}

async function garantirDestinoSeguro(sourceUrl: string): Promise<void> {
  const veredito = avaliarDestino(sourceUrl, hostsEsperados());
  if (!veredito.ok) {
    throw new Error(`destino de mídia recusado — ${veredito.motivo}`);
  }
  if (!veredito.hostConhecido) {
    console.warn(
      "media-relay: host de mídia fora do esperado (permitido, só registrando):",
      veredito.host,
    );
  }
  if (await resolveParaRedeInterna(veredito.host)) {
    throw new Error(
      `destino de mídia recusado — ${veredito.host} resolve para rede interna`,
    );
  }
}

async function baixarComRetry(sourceUrl: string): Promise<Response> {
  let ultimoStatus = 0;
  for (let tentativa = 0; ; tentativa++) {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) return response;
    ultimoStatus = response.status;
    // 4xx que não seja 404 é definitivo (403/410): repetir só queima tempo.
    const valeRepetir = response.status === 404 || response.status >= 500;
    if (!valeRepetir || tentativa >= RELAY_RETRY_DELAYS_MS.length) break;
    await new Promise((r) => setTimeout(r, RELAY_RETRY_DELAYS_MS[tentativa]));
  }
  throw new Error(`download da mídia retornou HTTP ${ultimoStatus}`);
}

export async function relayProviderMedia(
  sourceUrl: string,
  fallbackName = "arquivo",
): Promise<string> {
  await garantirDestinoSeguro(sourceUrl);
  const response = await baixarComRetry(sourceUrl);

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
