// Conta linhas das tabelas em public vs evohub pra ver onde os dados estão.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { env } from "../shared/env.ts";

const url = env("SUPABASE_URL"), key = env("SUPABASE_SERVICE_ROLE_KEY");
const tables = ["channels", "contacts", "conversations", "messages", "events"];

for (const schema of ["public", "evohub"]) {
  const db = createClient(url, key, { db: { schema }, auth: { persistSession: false } });
  const out = [];
  for (const t of tables) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    out.push(`${t}=${error ? "ERR(" + (error.code || error.message?.slice(0, 20)) + ")" : count}`);
  }
  console.log(`[${schema}]`, out.join("  "));
}
