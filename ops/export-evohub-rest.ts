// Exporta dados operacionais via PostgREST quando SUPABASE_DB_URL não está disponível.
// Não substitui o pg_dump: é um backup de dados, não de schema.
const env = new Map<string, string>();
for (const line of (await Deno.readTextFile(Deno.args[0] ?? ".env")).split(/\r?\n/)) {
  const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
  if (match) env.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ""));
}

const base = env.get("SUPABASE_URL")?.replace(/\/+$/, "");
const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
const schema = env.get("SUPABASE_SCHEMA") ?? "public";
if (!base || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes");

const out = Deno.args[1] ?? `ops/backups/rest-${new Date().toISOString().replace(/[:.]/g, "-")}`;
await Deno.mkdir(out, { recursive: true });

const tables = [
  "channels", "contacts", "conversations", "messages", "events", "deliveries",
  "sales_sequences", "scheduled_messages", "funnel_media", "campaign_queue",
  "campaign_flow_state", "leads_qualification", "llm_models", "llm_tasks",
];
const headers = {
  Authorization: `Bearer ${key}`,
  apikey: key,
  "Accept-Profile": schema,
};
const result: Record<string, unknown> = { created_at: new Date().toISOString(), schema, tables: {} };

for (const table of tables) {
  const rows: unknown[] = [];
  let offset = 0;
  let status = 200;
  let error = "";
  try {
    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch(`${base}/rest/v1/${table}?select=*&limit=1000&offset=${offset}`, {
          headers,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      status = res.status;
      if (!res.ok) { error = `${res.status} ${(await res.text()).slice(0, 240)}`; break; }
      const page = await res.json() as unknown[];
      rows.push(...page);
      if (page.length < 1000) break;
      offset += page.length;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (!error) await Deno.writeTextFile(`${out}/${table}.json`, JSON.stringify(rows, null, 2));
  (result.tables as Record<string, unknown>)[table] = { status, rows: rows.length, error: error || null };
}

await Deno.writeTextFile(`${out}/manifest.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ out, tables: result.tables }, null, 2));
