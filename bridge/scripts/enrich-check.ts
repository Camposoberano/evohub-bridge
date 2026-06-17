// Fase 1: /chat/check em lote pra todos os clientes pending (on_whatsapp null).
// Marca on_whatsapp, jid, lid, verified_name. enrich_status -> checked (ou no_wa).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BASE = (Deno.env.get("UAZAPI_URL") ?? "https://camposoberano.uazapi.com").replace(/\/+$/, "");
const ADMIN = Deno.env.get("UAZAPI_ADMIN_TOKEN")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// instância p/ lookup (qualquer connected serve)
const insts = await (await fetch(`${BASE}/instance/all`, { headers: { admintoken: ADMIN } })).json();
const inst = (Array.isArray(insts) ? insts : insts.instances ?? []).find((i: any) => (i.status ?? i.connectionStatus) === "connected");
const tok = inst?.token;
console.log("usando instância:", inst?.name ?? inst?.instanceName);

let done = 0;
while (true) {
  const { data: batch } = await db.from("clientes").select("phone").is("on_whatsapp", null).limit(50);
  if (!batch?.length) break;
  const numbers = batch.map((c) => c.phone);
  const r = await fetch(`${BASE}/chat/check`, { method: "POST", headers: { token: tok, "Content-Type": "application/json" }, body: JSON.stringify({ numbers }) });
  const arr = await r.json().catch(() => []);
  const byQ = new Map<string, any>();
  for (const it of (Array.isArray(arr) ? arr : [])) byQ.set(String(it.query).replace(/\D/g, ""), it);
  for (const c of batch) {
    const it = byQ.get(c.phone);
    await db.from("clientes").update({
      on_whatsapp: it ? !!it.isInWhatsapp : false,
      jid: it?.jid ?? null, lid: it?.lid ?? null, verified_name: it?.verifiedName ?? null,
      enrich_status: it?.isInWhatsapp ? "checked" : "no_wa",
      updated_at: new Date().toISOString(),
    }).eq("phone", c.phone);
  }
  done += batch.length;
  if (done % 500 === 0 || batch.length < 50) console.log(`checados ${done}`);
  await new Promise((res) => setTimeout(res, 2500)); // gentil p/ não flaggar
}
const { count: wa } = await db.from("clientes").select("phone", { count: "exact", head: true }).eq("on_whatsapp", true);
const { count: total } = await db.from("clientes").select("phone", { count: "exact", head: true });
console.log(`FIM. checados=${done} | com WhatsApp=${wa}/${total}`);
