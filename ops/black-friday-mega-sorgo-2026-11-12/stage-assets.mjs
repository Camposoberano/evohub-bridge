import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "file:///E:/Projetos_Novos/evohub/ops/prepare-isca-campaign.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const assetDir = join(here, "artes-rotacao");
const bucket = "soberano-out";
const prefix = "funil/black-friday-2026-11-12";
const files = ["bf-01.png", "bf-02.png", "bf-03.png"];
const env = await loadEnv("E:/Projetos_Novos/evohub");
const base = String(env.SUPABASE_URL).replace(/\/+$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const results = [];
for (const name of files) {
  const bytes = await readFile(join(assetDir, name));
  const objectPath = `${prefix}/${name}`;
  const publicUrl = `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
  const probe = await fetch(publicUrl, { method: "HEAD", signal: AbortSignal.timeout(20000) });
  const missing = probe.status === 404 || probe.status === 400;
  if (missing) {
    const uploadUrl = `${base}/storage/v1/object/${bucket}/${objectPath}`;
    const upload = await fetch(uploadUrl, {
      method: "POST",
      headers: { ...auth, "Content-Type": "image/png", "x-upsert": "false" },
      body: bytes,
      signal: AbortSignal.timeout(60000),
    });
    if (!upload.ok) throw new Error(`Upload ${name} HTTP ${upload.status}`);
  } else if (!probe.ok) {
    throw new Error(`HEAD ${name} HTTP ${probe.status}`);
  }
  const verified = await fetch(publicUrl, { method: "HEAD", signal: AbortSignal.timeout(20000) });
  const contentType = verified.headers.get("content-type") || "";
  const length = Number(verified.headers.get("content-length") || 0);
  if (!verified.ok || !contentType.toLowerCase().includes("image/png") || (length && length !== bytes.length)) {
    throw new Error(`Verificação falhou para ${name}: HTTP ${verified.status}, ${contentType}, ${length}`);
  }
  results.push({ file: name, url: publicUrl, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(join(here, "asset-urls.json"), JSON.stringify(results, null, 2) + "\n", { flag: "wx" }).catch(async (error) => {
  if (error.code !== "EEXIST") throw error;
  const previous = JSON.parse(await readFile(join(here, "asset-urls.json"), "utf8"));
  if (JSON.stringify(previous) !== JSON.stringify(results)) throw new Error("asset-urls.json já existe com conteúdo diferente");
});
console.log(JSON.stringify(results.map(({ file, url, bytes }) => ({ file, url, bytes }))));
