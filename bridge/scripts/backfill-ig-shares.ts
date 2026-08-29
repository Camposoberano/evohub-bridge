// backfill-ig-shares — corrige entradas antigas do Instagram/Facebook que foram gravadas como
// "[anexo]" / msg_type "unknown" porque o campo `shares` não era pedido à Graph.
//
// Cada uma dessas linhas é um lead que compartilhou um reel ou post no direct — sinal de
// interesse que hoje aparece no Chatwoot sem dizer sobre o quê. O conserto do fluxo normal só
// vale pra mensagem nova; estas já estão no banco como duplicata e nunca seriam reprocessadas.
//
// Rodar (a partir de bridge/):
//   deno run --allow-net --allow-env --env-file=../.env scripts/backfill-ig-shares.ts
//   ...mesma linha com --apply para gravar. Sem --apply é simulação.
import { admin } from "../shared/supabase.ts";
import { getMeta } from "../shared/hub.ts";
import { conteudoDeEntrada, extractShareLinks } from "../handlers/sync-facebook.ts";

type Json = Record<string, unknown>;

const APPLY = Deno.args.includes("--apply");
const db = admin();

const { data: canais } = await db.from("channels")
  .select("id,name,type")
  .in("type", ["facebook", "instagram"])
  .eq("status", "active");

console.log(
  `backfill de compartilhamentos — ${
    APPLY ? "APLICANDO" : "SIMULAÇÃO (use --apply para gravar)"
  }`,
);

const totais = { verificadas: 0, corrigidas: 0, semShare: 0, erros: 0 };

for (const canal of canais ?? []) {
  const { data: secret } = await db.from("channel_secrets")
    .select("channel_token").eq("channel_id", canal.id).maybeSingle();
  const token = secret?.channel_token as string | undefined;
  if (!token) {
    console.log(`· ${canal.name}: sem token — ignorado`);
    continue;
  }

  const convs = await getMeta(token, "me/conversations?fields=id&limit=50");
  if (!convs.ok) {
    console.log(`· ${canal.name}: Graph ${convs.status} — ignorado`);
    totais.erros++;
    continue;
  }

  let corrigidasNoCanal = 0;
  for (const conv of ((convs.data as Json)?.data as Json[]) ?? []) {
    const campos = encodeURIComponent("id,message,shares{link}");
    const msgs = await getMeta(
      token,
      `${conv.id}/messages?fields=${campos}&limit=50`,
    );
    if (!msgs.ok) continue;

    for (const m of ((msgs.data as Json)?.data as Json[]) ?? []) {
      const links = extractShareLinks(m);
      if (!links.length) continue;

      const { data: linha } = await db.from("messages")
        .select("id,content,msg_type")
        .eq("meta_message_id", m.id as string)
        .maybeSingle();
      if (!linha) continue;
      totais.verificadas++;

      // só mexe no que ficou sem conteúdo útil; mensagem já correta fica intacta
      const semConteudo = !linha.content ||
        /^\[(anexo|imagem|audio|video|documento)\]$/.test(
          String(linha.content).trim(),
        );
      if (!semConteudo) continue;

      const novoConteudo = conteudoDeEntrada(m, "unknown");
      console.log(
        `   ${APPLY ? "corrigindo" : "[simulado]"} ${canal.name}: ${
          String(linha.content).trim()
        } -> ${novoConteudo.slice(0, 60)}`,
      );
      if (APPLY) {
        const { error } = await db.from("messages")
          .update({ content: novoConteudo, msg_type: "text" })
          .eq("id", linha.id);
        if (error) {
          console.error("      falhou:", error.message);
          totais.erros++;
          continue;
        }
      }
      corrigidasNoCanal++;
      totais.corrigidas++;
    }
  }
  console.log(`· ${canal.name}: ${corrigidasNoCanal} corrigidas`);
}

console.log("\nresumo:", JSON.stringify(totais));
if (!APPLY) console.log("nada foi gravado — rode de novo com --apply");
