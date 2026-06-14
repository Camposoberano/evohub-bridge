// Lista objetos no bucket chatwoot-media (Supabase Storage REST, service role).
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/list-bucket.ts
const URL = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const r = await fetch(`${URL}/storage/v1/object/list/chatwoot-media`, {
  method: "POST",
  headers: { apikey: KEY!, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: "", limit: 100, sortBy: { column: "created_at", order: "desc" } }),
});
const data = await r.json().catch(() => null);
if (!Array.isArray(data)) { console.log("resposta:", JSON.stringify(data).slice(0, 200)); Deno.exit(0); }
console.log("objetos no bucket:", data.length);
for (const o of data.slice(0, 30)) console.log(`- ${o.name} (${o.metadata?.size ?? "?"} bytes) ${o.created_at ?? ""}`);
