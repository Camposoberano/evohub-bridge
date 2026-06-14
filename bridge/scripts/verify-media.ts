// Verifica fluxo de mídia: por canal/tipo, quantas msgs e quantas com media_url.
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/verify-media.ts
import { admin } from "../shared/supabase.ts";
const db = admin();

const { data: channels } = await db.from("channels").select("id,name,type");
const byId = Object.fromEntries((channels ?? []).map((c) => [c.id, c]));

const { data: msgs } = await db.from("messages")
  .select("channel_id,direction,msg_type,media_url")
  .limit(5000);

const agg = {};
for (const m of msgs ?? []) {
  const ch = byId[m.channel_id];
  const key = `${ch?.type ?? "?"} | ${m.msg_type} | ${m.direction}`;
  agg[key] = agg[key] || { total: 0, comMedia: 0 };
  agg[key].total++;
  if (m.media_url) agg[key].comMedia++;
}

console.log("canal | tipo | direcao -> total (com media_url)");
for (const k of Object.keys(agg).sort()) {
  const a = agg[k];
  const flag = (k.includes("image") || k.includes("audio") || k.includes("video") || k.includes("document"))
    ? (a.comMedia === a.total ? " OK" : a.comMedia === 0 ? " SEM MEDIA" : " PARCIAL")
    : "";
  console.log(`${k} -> ${a.total} (${a.comMedia})${flag}`);
}
console.log("\ntotal mensagens:", (msgs ?? []).length);
