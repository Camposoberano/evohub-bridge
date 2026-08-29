// backfill-uazapi-inbound — recupera mensagens de ENTRADA que a uazapi entregou mas que
// nunca chegaram na tabela `messages`.
//
// Contexto (29/08/2026): `ingestInbound` tirava o claim de dedup antes do trabalho e não o
// devolvia no erro; falha transitória (Chatwoot 502, download de mídia 404) apagava a
// mensagem em definitivo, porque a retentativa do webhook batia no claim. O defeito já foi
// corrigido — este script recupera o que se perdeu antes da correção.
//
// Chama `ingestInbound` DIRETO, de propósito: reenviar pelo /uazapi-webhook reprocessaria as
// automações e dispararia resposta atrasada para quem escreveu há horas. Aqui só o histórico
// é reconstruído (banco + Chatwoot), reabrindo a janela sem falar com o cliente.
//
// Rodar (a partir de bridge/):
//   deno run --allow-net --allow-env --env-file=../.env scripts/backfill-uazapi-inbound.ts
//   ...mesma linha com --apply para gravar de verdade. Sem --apply é simulação.
//   --horas=48 amplia a janela (padrão 24).
import { admin, releaseDelivery } from "../shared/supabase.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { ingestInbound, type InboundAttachment } from "../shared/inbound.ts";
import { instPost, listInstances } from "../shared/uazapi.ts";

type Json = Record<string, unknown>;

const APPLY = Deno.args.includes("--apply");
const HORAS = Number(
  Deno.args.find((a) => a.startsWith("--horas="))?.split("=")[1] ?? "24",
);
const DESDE = Date.now() - HORAS * 60 * 60 * 1000;
const MAX_BYTES = 15 * 1024 * 1024;

const db = admin();

function ts(m: Json): number {
  const raw = Number(m.messageTimestamp ?? 0);
  return raw > 1e12 ? raw : raw * 1000;
}

function isMedia(t: string): boolean {
  return /Audio|Image|Video|Document|Sticker/i.test(t);
}

// Mesmo caminho do webhook: bytes descriptografados pela própria uazapi.
async function baixarMidia(
  token: string,
  messageId: string,
  msgType: string,
): Promise<InboundAttachment[] | undefined> {
  try {
    const r = await instPost("/message/download", token, {
      id: messageId,
      return_base64: true,
      return_link: false,
      generate_mp3: /audio|ptt/i.test(msgType),
    });
    if (!r.ok) return undefined;
    const d = r.data as Json;
    const b64 = (d.base64Data ?? d.base64) as string | undefined;
    if (!b64) return undefined;
    const bytes = Uint8Array.from(
      atob(b64.replace(/^data:[^;]+;base64,/, "")),
      (c) => c.charCodeAt(0),
    );
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return undefined;
    const mime = (d.mimetype as string | undefined) ??
      (/audio|ptt/i.test(msgType) ? "audio/mpeg" : "application/octet-stream");
    const ext = mime.split("/")[1]?.split(";")[0] ?? "bin";
    return [{
      filename: `midia.${ext}`,
      contentType: mime,
      bytes,
      sourceUrl: d.fileURL as string | undefined,
    }];
  } catch {
    return undefined;
  }
}

async function canalDaInstancia(nome: string): Promise<Json | null> {
  const { data: porExternal } = await db.from("channels").select("*")
    .eq("external_id", nome).maybeSingle();
  if (porExternal) return porExternal as Json;
  const { data: porNome } = await db.from("channels").select("*")
    .eq("name", nome).maybeSingle();
  return (porNome as Json) ?? null;
}

console.log(
  `backfill uazapi — janela de ${HORAS}h — ${
    APPLY ? "APLICANDO" : "SIMULAÇÃO (use --apply para gravar)"
  }`,
);

// ids já gravados na janela (com folga, pra não reinserir o que já existe)
const gravados = new Set<string>();
for (let off = 0; off < 20000; off += 1000) {
  const { data } = await db.from("messages").select("meta_message_id")
    .gte("created_at", new Date(DESDE - 2 * 60 * 60 * 1000).toISOString())
    .limit(1000).range(off, off + 999);
  if (!data?.length) break;
  for (const m of data) if (m.meta_message_id) gravados.add(m.meta_message_id);
}
console.log(`ids já gravados na janela: ${gravados.size}`);

const totais = { recuperadas: 0, semCanal: 0, falhas: 0, puladas: 0 };

for (const inst of await listInstances()) {
  const canal = await canalDaInstancia(inst.name);
  if (!canal) {
    console.log(`· ${inst.name}: sem canal cadastrado — ignorado`);
    continue;
  }
  const acct = await accountForChannel(canal.id as string);
  const r = await instPost("/message/find", inst.token, { limit: 2000 });
  const lista = (Array.isArray(r.data)
    ? r.data
    : ((r.data as Json)?.messages ?? [])) as Json[];

  const perdidas = lista.filter((m) =>
    m.fromMe === false && m.isGroup === false && ts(m) >= DESDE &&
    typeof m.id === "string" && !gravados.has(m.id)
  );
  console.log(`· ${inst.name}: ${perdidas.length} a recuperar`);

  for (const m of perdidas) {
    const id = m.id as string;
    const tipo = String(m.messageType ?? "text");
    const de = String(m.chatid ?? "").replace(/@.*$/, "");
    const texto = String(
      m.text ?? (m.content as Json | undefined)?.text ?? "",
    );
    const quando = new Date(ts(m)).toISOString();
    if (!de) {
      totais.puladas++;
      continue;
    }
    if (!APPLY) {
      console.log(`   [simulado] ${quando} ${de} ${tipo} ${texto.slice(0, 40)}`);
      totais.recuperadas++;
      continue;
    }
    try {
      // O claim órfão da tentativa que falhou ainda está lá e bloquearia a reingestão.
      await releaseDelivery(db, `wa-${canal.id}-${id}`);
      const anexos = isMedia(tipo)
        ? await baixarMidia(inst.token, String(m.messageid ?? id), tipo)
        : undefined;
      const res = await ingestInbound(db, canal, {
        from: de,
        name: (m.senderName as string | undefined) ?? undefined,
        metaMessageId: id,
        msgType: tipo,
        content: texto,
        attachments: anexos,
        sentAt: quando,
        acct,
      });
      if (res.inserted) totais.recuperadas++;
      else totais.puladas++;
      console.log(
        `   ${res.inserted ? "ok" : "pulada(" + res.reason + ")"} ${quando} ${de} ${tipo}`,
      );
    } catch (e) {
      totais.falhas++;
      console.error(`   FALHA ${quando} ${de} ${tipo}:`, String(e).slice(0, 160));
    }
  }
}

console.log("\nresumo:", JSON.stringify(totais));
if (!APPLY) console.log("nada foi gravado — rode de novo com --apply");
