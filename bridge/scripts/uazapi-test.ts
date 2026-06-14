// Testa conexão com uazapi: lista instâncias (admintoken).
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/uazapi-test.ts
import { env } from "../shared/env.ts";
const URL = env("UAZAPI_URL").replace(/\/+$/, "");
const ADMIN = env("UAZAPI_ADMIN_TOKEN");

const r = await fetch(`${URL}/instance/all`, { headers: { admintoken: ADMIN } });
console.log("status:", r.status);
const data = await r.json().catch(() => null);
if (!Array.isArray(data)) { console.log("resposta:", JSON.stringify(data).slice(0, 300)); Deno.exit(0); }
console.log("instâncias:", data.length);
for (const i of data) {
  console.log(`- ${i.name ?? i.instanceName ?? "?"} | num=${i.owner ?? i.phone ?? i.number ?? "?"} | status=${i.status ?? i.connectionStatus ?? "?"} | token=${i.token ? "sim" : "não"}`);
}
