// Liga o webhook das instâncias uazapi conectadas → nosso bridge público.
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/uazapi-set-webhook.ts
import { listInstances, instPost } from "../shared/uazapi.ts";
import { env, optionalEnv } from "../shared/env.ts";

const base = env("BRIDGE_PUBLIC_BASE").replace(/\/+$/, "");
const token = optionalEnv("UAZAPI_WEBHOOK_TOKEN") ?? env("CHATWOOT_WEBHOOK_SECRET");
const url = `${base}/uazapi-webhook?token=${encodeURIComponent(token)}`;
const events = ["messages", "messages_update", "connection", "sender", "call"];

const insts = (await listInstances()).filter((i) => i.status === "connected");
console.log(`ligando webhook em ${insts.length} instâncias conectadas → ${base}/uazapi-webhook`);
for (const i of insts) {
  const r = await instPost("/webhook", i.token, { url, enabled: true, events, action: "add" });
  console.log(`- ${i.name}: ${r.ok ? "ok" : "ERRO " + JSON.stringify(r.data).slice(0, 120)}`);
}
