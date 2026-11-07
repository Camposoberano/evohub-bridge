// Cadastra somente mídias da versão 7d, sem sobrescrever o funil vigente.
// deno run -A --env-file=<env-local> bridge/scripts/stage-mega-sorgo-7d-media.ts [--apply]
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEGA_SORGO_7D_VERSION, SEVEN_DAY_CONTENT,
  SEVEN_DAY_CONDITIONAL_VIDEOS } from "../shared/mega-sorgo-7d-content.ts";

type Item = { slot: string; type: string; asset: string; sourcePath?: string; sourceUrl?: string };
const apply = Deno.args.includes("--apply");
const base = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!base || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
const db = createClient(base, key, { auth: { persistSession: false }, db: { schema: "public" } });
const bucket = "soberano-out";
const videoRoot = "D:/sementes/SORGO/videos sobre o mega sorgo santa elisa";
const photoRoot = "E:/Projetos_Novos/analise-agro-sorgo/prova-social";
const audioRoot = "C:/Users/User/Downloads";
const editedRoot = "ops/mega-sorgo-7d-media";
const inherited: Record<string, [number, string]> = {
  logo: [1, "logo"],
  logistica: [0, "logistica_img"],
  "pacote-2kg": [0, "preco_2kg"],
  "Silagem de Sorgo — Embrapa.pdf": [0, "isca_silagem"],
};

function mime(asset: string): string {
  if (asset.endsWith(".ogg")) return "audio/ogg";
  if (asset.endsWith(".mp4")) return "video/mp4";
  if (asset.endsWith(".jpg") || asset.endsWith(".jpeg")) return "image/jpeg";
  if (asset.endsWith(".png")) return "image/png";
  if (asset.endsWith(".pdf")) return "application/pdf";
  throw new Error(`tipo não reconhecido: ${asset}`);
}

const { data: oldMedia, error: oldError } = await db.from("funnel_media")
  .select("day,slot,url,type").eq("funnel", "mega-sorgo").eq("active", true).limit(1000);
if (oldError) throw oldError;
const { data: existing, error: existingError } = await db.from("funnel_media")
  .select("slot,url,type").eq("funnel", MEGA_SORGO_7D_VERSION).eq("day", 0).limit(1000);
if (existingError) throw existingError;
const existingSlots = new Map((existing ?? []).map((row) => [row.slot, row]));

const items: Item[] = [];
for (const piece of SEVEN_DAY_CONTENT) {
  if (!piece.asset) continue;
  const slot = String((piece.payload.media_ref as { slot: string }).slot);
  items.push({ slot, asset: piece.asset, type: piece.type });
}
for (const video of SEVEN_DAY_CONDITIONAL_VIDEOS) {
  items.push({ slot: video.payload.media_ref.slot, asset: video.asset, type: video.type });
}
for (const item of items) {
  const source = inherited[item.asset];
  if (source) {
    const row = (oldMedia ?? []).find((candidate) => candidate.day === source[0] &&
      candidate.slot === source[1] && candidate.type === item.type);
    if (!row?.url) throw new Error(`mídia legada ausente: ${item.asset}`);
    item.sourceUrl = String(row.url);
  } else if (item.asset.startsWith("prova-social/")) {
    item.sourcePath = `${photoRoot}/${item.asset.split("/").pop()}`;
  } else if (item.asset.endsWith(".ogg")) {
    item.sourcePath = item.asset.includes("_corte")
      ? `${editedRoot}/${item.asset}` : `${audioRoot}/${item.asset}`;
  } else {
    const optimized = `${editedRoot}/${item.asset}`;
    item.sourcePath = await Deno.stat(optimized).then(() => optimized).catch(() => `${videoRoot}/${item.asset}`);
  }
  if (item.sourcePath) await Deno.stat(item.sourcePath);
  console.log(`${existingSlots.has(item.slot) ? "EXISTE" : apply ? "SUBIR" : "PREPARAR"} ${item.slot} ${item.asset}`);
}
if (!apply) {
  console.log(`${items.length} mídias localizadas; executar --apply para cadastrar.`);
  Deno.exit(0);
}

for (const item of items) {
  if (existingSlots.has(item.slot)) continue;
  const sourceName = item.sourceUrl
    ? new URL(item.sourceUrl).pathname.split("/").pop()!
    : item.asset.split("/").pop()!;
  const fileName = `${item.slot}_${sourceName}`.replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `funil/${MEGA_SORGO_7D_VERSION}/${fileName}`;
  const publicUrl = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  let exists = false;
  try { exists = (await fetch(publicUrl, { method: "HEAD" })).ok; } catch { /* upload tenta e reporta */ }
  if (!exists) {
    const bytes = item.sourcePath
      ? await Deno.readFile(item.sourcePath)
      : new Uint8Array(await (await fetch(item.sourceUrl!)).arrayBuffer());
    const mediaType = item.sourceUrl ? mime(new URL(item.sourceUrl).pathname) : mime(item.asset);
    const { error: uploadError } = await db.storage.from(bucket).upload(path,
      new Blob([new Uint8Array(bytes)], { type: mediaType }),
      { contentType: mediaType, upsert: false });
    if (uploadError) throw new Error(`upload ${item.slot}: ${uploadError.message}`);
  }
  const head = await fetch(publicUrl, { method: "HEAD" });
  if (!head.ok) throw new Error(`mídia inacessível após upload: ${item.slot} HTTP ${head.status}`);
  const { error: insertError } = await db.from("funnel_media").insert({
    funnel: MEGA_SORGO_7D_VERSION, day: 0, slot: item.slot,
    type: item.type, url: publicUrl, active: true,
  });
  if (insertError) throw new Error(`registro ${item.slot}: ${insertError.message}`);
  console.log(`OK ${item.slot}`);
}
console.log(`Cadastro concluído: ${items.length} slots.`);
