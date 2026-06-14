// Aplica migrations SQL ao Postgres alvo, sem precisar de psql/supabase CLI.
// Uso:
//   node --env-file=.env scripts/apply-migration.mjs
//   node --env-file=.env scripts/apply-migration.mjs 0002_llm_orchestration.sql
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
const availableFiles = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const requestedFiles = process.argv.slice(2).map((arg) => {
  const file = arg.endsWith(".sql") ? arg : `${arg}.sql`;
  if (file.includes("/") || file.includes("\\")) {
    console.error(`ERRO: informe apenas o nome do arquivo da migration: ${arg}`);
    process.exit(1);
  }
  if (!availableFiles.includes(file)) {
    console.error(`ERRO: migration nao encontrada: ${file}`);
    console.error(`Disponiveis: ${availableFiles.join(", ")}`);
    process.exit(1);
  }
  return file;
});
const files = requestedFiles.length ? requestedFiles : availableFiles;

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
