// Aplica supabase/migrations/*.sql ao Postgres alvo, sem precisar de psql/supabase CLI.
// Uso: node --env-file=.env scripts/apply-migration.mjs   (precisa SUPABASE_DB_URL)
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("ERRO: defina SUPABASE_DB_URL no .env");
  process.exit(1);
}

const dir = join(__dirname, "..", "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const f of files) {
    const sql = readFileSync(join(dir, f), "utf8");
    console.log(`-> aplicando ${f} (${sql.length} bytes)`);
    await client.query(sql);
    console.log(`   ok`);
  }
  console.log("migrations aplicadas com sucesso.");
} catch (e) {
  console.error("falha na migration:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
