// Substitui somente os cinco ganchos mudos da versão isolada por cópias narradas.
// deno run -A --env-file=<env-local> bridge/scripts/repair-mega-sorgo-7d-voiceovers.ts [--apply]
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { MEGA_SORGO_7D_VERSION } from "../shared/mega-sorgo-7d-content.ts";

const apply = Deno.args.includes("--apply");
const base = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!base || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");
const db = createClient(base, key, { auth: { persistSession: false }, db: { schema: "public" } });
const bucket = "soberano-out";
const clips = [
  ["p06", "p06_narrado_leve.mp4"],
  ["p11", "p11_narrado_leve.mp4"],
  ["p16", "p16_narrado_leve.mp4"],
  ["p22", "p22_narrado_leve.mp4"],
  ["p24v", "p24v_narrado_leve.mp4"],
] as const;
const conversations = [
  "b1f6fec3-c120-42a7-9c6c-3eb1be379e24", // 5895, Chatwoot 673
  "cd345968-602a-4a9d-aa33-d60cc53f7800", // 6836, Chatwoot 1286
];

for (const [slot, file] of clips) {
  const bytes = await Deno.readFile(new URL(`../../ops/mega-sorgo-7d-media/${file}`, import.meta.url));
  const path = `funil/${MEGA_SORGO_7D_VERSION}/narrado-20261107/${file}`;
  const url = db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const { data: media, error: mediaError } = await db.from("funnel_media")
    .select("id,url,type").eq("funnel", MEGA_SORGO_7D_VERSION)
    .eq("day", 0).eq("slot", slot).eq("active", true).single();
  if (mediaError || !media || media.type !== "video") throw new Error(`slot ${slot} inválido`);
  const { data: rows, error: rowsError } = await db.from("scheduled_messages")
    .select("id,conversation_id,status,payload")
    .eq("funnel", MEGA_SORGO_7D_VERSION)
    .eq("type", "video")
    .in("conversation_id", conversations)
    .in("status", ["paused", "pending"])
    .contains("payload", { __funnel_piece_code: slot === "p24v" ? "24v" : slot.slice(1) });
  if (rowsError) throw rowsError;
  console.log(`${slot}: ${bytes.length} bytes, ${rows?.length ?? 0} peças por atualizar`);
  if (!apply) continue;

  const headBefore = await fetch(url, { method: "HEAD" });
  if (!headBefore.ok) {
    const { error: uploadError } = await db.storage.from(bucket).upload(path,
      new Blob([new Uint8Array(bytes)], { type: "video/mp4" }),
      { contentType: "video/mp4", upsert: false });
    if (uploadError) throw new Error(`upload ${slot}: ${uploadError.message}`);
  }
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok || !String(head.headers.get("content-type")).startsWith("video/mp4")) {
    throw new Error(`URL narrada inválida: ${slot}`);
  }
  const { error: libraryError } = await db.from("funnel_media")
    .update({ url }).eq("id", media.id).eq("url", media.url);
  if (libraryError) throw libraryError;
  for (const row of rows ?? []) {
    const payload = { ...(row.payload as Record<string, unknown>), media_url: url };
    const { error: queueError } = await db.from("scheduled_messages")
      .update({ payload }).eq("id", row.id).eq("status", row.status);
    if (queueError) throw queueError;
  }
  console.log(`${slot}: atualizado`);
}
