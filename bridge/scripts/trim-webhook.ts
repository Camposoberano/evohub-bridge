// Enxuga o webhook uazapi: deixa só "messages" (corta Played/Delivered/status spam).
// Rodar: deno run --allow-net --allow-env --env-file=.env bridge/scripts/trim-webhook.ts
import { listInstances, instGet, instPost } from "../shared/uazapi.ts";

for (const i of (await listInstances()).filter((x) => x.status === "connected")) {
  const r = await instGet("/webhook", i.token);
  const hooks = Array.isArray(r.data) ? r.data as Record<string, unknown>[] : [];
  const nosso = hooks.find((h) => String(h.url ?? "").includes("cofre.camposoberano"));
  if (!nosso) { console.log(`${i.name}: nosso webhook não achado`); continue; }
  const up = await instPost("/webhook", i.token, { id: nosso.id, url: nosso.url, enabled: true, events: ["messages"], action: "update" });
  console.log(`${i.name}: ${up.ok ? "events=[messages] ok" : "ERRO " + JSON.stringify(up.data).slice(0, 100)}`);
}
