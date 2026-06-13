// Testa download de mídia WhatsApp DIRETO na Graph API da Meta, usando META_ACCESS_TOKEN
// do .env (token de Usuário do Sistema com acesso à WABA). Não imprime o token.
//
// Pré-req: adicionar no bridge/.env:
//   META_ACCESS_TOKEN=<token>
//   (opcional) META_GRAPH_VERSION=v21.0
//
// Rodar: deno run --allow-net --allow-env --env-file=.env scripts/test-meta-direct.ts
import { admin } from "../shared/supabase.ts";
import { optionalEnv } from "../shared/env.ts";

type Json = Record<string, unknown>;

const metaToken = optionalEnv("META_ACCESS_TOKEN");
if (!metaToken) {
  console.error("FALTA META_ACCESS_TOKEN no .env. Adicione e rode de novo.");
  Deno.exit(1);
}
const version = optionalEnv("META_GRAPH_VERSION") ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${version}`;

const db = admin();

// Pega o media_id mais recente de entrada (image/audio/video/document) dos eventos do Hub.
const { data: events } = await db.from("events").select("payload").eq("source", "hub")
  .eq("event_type", "whatsapp_business_account").order("received_at", { ascending: false }).limit(50);

let found: { id: string; type: string } | null = null;
for (const e of events ?? []) {
  const changes = (((e.payload as Json).entry as Json[] | undefined)?.[0]?.changes as Json[] | undefined) ?? [];
  for (const ch of changes) {
    for (const m of (((ch.value as Json)?.messages as Json[] | undefined) ?? [])) {
      const t = m.type as string;
      const md = (m[t] as Json) ?? {};
      if (md.id && ["image", "audio", "video", "document", "sticker"].includes(t)) {
        found = { id: md.id as string, type: t };
        break;
      }
    }
    if (found) break;
  }
  if (found) break;
}

if (!found) {
  console.error("Nenhum media_id de entrada recente nos eventos. Mande uma imagem/áudio e rode de novo.");
  Deno.exit(1);
}
console.log(`alvo: media_id=${found.id} type=${found.type} | graph=${version}`);

// Passo 1: metadados (GET /<media_id>)
const metaRes = await fetch(`${GRAPH}/${found.id}`, {
  headers: { Authorization: `Bearer ${metaToken}` },
});
const metaBody = await metaRes.json().catch(() => ({}));
console.log("PASSO 1 metadata ->", metaRes.status, JSON.stringify(metaBody).slice(0, 400));
if (!metaRes.ok) {
  console.error("\n>>> Token NÃO resolve o media_id (provável bloqueio shared/permissão). Veja o erro acima.");
  Deno.exit(0);
}

const url = (metaBody as Json).url as string | undefined;
if (!url) { console.error("metadata sem url"); Deno.exit(0); }

// Passo 2: bytes (GET <url> com Bearer)
const binRes = await fetch(url, { headers: { Authorization: `Bearer ${metaToken}` } });
const ct = binRes.headers.get("content-type");
const len = binRes.headers.get("content-length");
console.log("PASSO 2 download ->", binRes.status, ct, "len", len);
if (binRes.ok) {
  const bytes = new Uint8Array(await binRes.arrayBuffer());
  console.log(`\n>>> SUCESSO! Baixou ${bytes.byteLength} bytes (${ct}). Dá pra ligar no bridge.`);
} else {
  console.error("\n>>> Metadata OK mas download falhou. Erro:", (await binRes.text()).slice(0, 300));
}
