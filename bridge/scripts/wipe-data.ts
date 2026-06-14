// Zera a base do painel (analytics) + bucket de mídia. MANTÉM channels e channel_secrets.
// NÃO toca no banco do próprio Chatwoot (sistema separado).
// IRREVERSÍVEL. Rodar só com --confirm:
//   deno run --allow-net --allow-env --env-file=.env bridge/scripts/wipe-data.ts --confirm
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

if (!Deno.args.includes("--confirm")) {
  console.log("DRY-RUN. Pra apagar de verdade, rode com --confirm");
  Deno.exit(0);
}

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { db: { schema: "public" }, auth: { persistSession: false } });
// ordem respeita FKs: messages -> conversations -> contacts. col = coluna NOT NULL p/ filtrar tudo.
const tables = [
  { t: "messages", col: "id" },
  { t: "conversations", col: "id" },
  { t: "contacts", col: "id" },
  { t: "events", col: "id" },
  { t: "daily_metrics", col: "day" },
  { t: "deliveries", col: "delivery_id" },
];
for (const { t, col } of tables) {
  const { error, count } = await db.from(t).delete({ count: "exact" }).not(col, "is", null);
  console.log(`${t}: ${error ? "ERRO " + error.message : "apagados " + (count ?? "?")}`);
}

// limpa bucket
// deno-lint-ignore no-explicit-any
const st = (db as any).storage.from("chatwoot-media");
const { data: objs } = await st.list("", { limit: 1000 });
if (objs?.length) { await st.remove(objs.map((o: { name: string }) => o.name)); console.log(`bucket: removidos ${objs.length}`); }
else console.log("bucket: vazio");

console.log("OK — base zerada (channels e secrets mantidos).");
