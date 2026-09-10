// restaurar-midia-funil — recoloca no bucket `soberano-out` as mídias do funil que a
// retenção apagou em 08/09.
//
// O que aconteceu: a retenção passou a descer nas pastas (correção certa — `ptt/` estava
// invisível) e foi aplicada com 7 dias ao `soberano-out`. As mídias do funil moravam no mesmo
// bucket, em `funil/mega-sorgo/` e `mega-sorgo/`, e são de junho. Foram apagadas junto com as
// cópias descartáveis de PTT.
//
// O Chatwoot não tem cópia: para envio de saída o bridge registra um rótulo de texto, não
// sobe o arquivo. A recuperação depende dos originais.
//
// Uso:
//   deno run -A bridge/scripts/restaurar-midia-funil.ts <pasta-com-os-originais> [--aplicar]
//
// Sem `--aplicar` é ENSAIO: mostra o que casaria e o que falta, sem subir nada. O padrão é
// não escrever — quem roda isso está consertando um estrago e merece ver antes.
//
// O casamento é por NOME DE ARQUIVO, recursivo na pasta indicada: a origem pode estar
// organizada de qualquer jeito, o destino é sempre o caminho registrado em `funnel_media`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "soberano-out";

type Alvo = { caminho: string; nome: string };

function env(nome: string): string {
  const v = Deno.env.get(nome);
  if (!v) throw new Error(`env ${nome} ausente`);
  return v;
}

/** Caminhos que `funnel_media` referencia dentro do bucket, sem repetição. */
async function alvosDoBanco(
  // deno-lint-ignore no-explicit-any
  db: any,
): Promise<Alvo[]> {
  const { data, error } = await db.from("funnel_media").select("url");
  if (error) throw new Error(`funnel_media: ${error.message}`);
  const vistos = new Set<string>();
  const alvos: Alvo[] = [];
  for (const linha of (data ?? []) as { url: string }[]) {
    const marca = `/${BUCKET}/`;
    const i = String(linha.url ?? "").indexOf(marca);
    if (i < 0) continue;
    const caminho = decodeURIComponent(String(linha.url).slice(i + marca.length));
    if (!caminho || vistos.has(caminho)) continue;
    vistos.add(caminho);
    alvos.push({ caminho, nome: caminho.split("/").pop() ?? caminho });
  }
  return alvos;
}

/**
 * Nome como o Supabase o gravou: espaço vira `_` e acento cai.
 *
 * Sem isso o casamento por nome literal acha 12 de 64 — o original no disco é
 * "audio 01 - fase 01.ogg" e no bucket está "audio_01_-_fase_01.ogg".
 */
function chave(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_").toLowerCase();
}

/**
 * Índice nome-normalizado -> caminho local, varrendo a pasta inteira.
 *
 * Arquivo dentro de uma subpasta `_comprimido` também é indexado com o prefixo
 * `comprimido_`: foi assim que a versão reduzida foi nomeada no bucket, e sem essa
 * segunda chave 11 imagens ficariam órfãs.
 */
async function indexarPasta(raiz: string): Promise<Map<string, string>> {
  const indice = new Map<string, string>();
  async function anda(dir: string, dentroDeComprimido: boolean) {
    for await (const e of Deno.readDir(dir)) {
      const caminho = `${dir}/${e.name}`;
      if (e.isDirectory) {
        await anda(caminho, dentroDeComprimido || /_comprimido/i.test(e.name));
        continue;
      }
      const chaves = [chave(e.name)];
      if (dentroDeComprimido) chaves.push(chave("comprimido_" + e.name));
      for (const c of chaves) {
        // primeiro encontrado vence: avisa em vez de escolher em silêncio
        if (indice.has(c)) console.warn(`  ⚠ nome repetido na origem, mantendo o primeiro: ${e.name}`);
        else indice.set(c, caminho);
      }
    }
  }
  await anda(raiz, false);
  return indice;
}

function tipoDe(nome: string): string {
  const ext = (nome.split(".").pop() ?? "").toLowerCase();
  const mapa: Record<string, string> = {
    ogg: "audio/ogg", mp3: "audio/mpeg", mp4: "video/mp4",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", pdf: "application/pdf",
  };
  return mapa[ext] ?? "application/octet-stream";
}

async function main() {
  const args = [...Deno.args];
  const aplicar = args.includes("--aplicar");
  const pasta = args.find((a) => !a.startsWith("--"));
  if (!pasta) {
    console.error("uso: deno run -A restaurar-midia-funil.ts <pasta> [--aplicar]");
    Deno.exit(1);
  }

  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
    db: { schema: Deno.env.get("SUPABASE_SCHEMA") ?? "public" },
  });

  const alvos = await alvosDoBanco(db);
  console.log(`alvos em funnel_media: ${alvos.length}`);
  const indice = await indexarPasta(pasta);
  console.log(`arquivos na origem: ${indice.size}`);
  console.log(aplicar ? "\nMODO: APLICANDO\n" : "\nMODO: ensaio (use --aplicar para subir)\n");

  const faltando: string[] = [];
  let enviados = 0, jaExistiam = 0, falhas = 0;

  for (const alvo of alvos) {
    const origem = indice.get(chave(alvo.nome));
    if (!origem) { faltando.push(alvo.caminho); continue; }
    if (!aplicar) { console.log(`  casa  ${alvo.caminho}`); enviados++; continue; }

    try {
      const bytes = await Deno.readFile(origem);
      // upsert: o arquivo pode ter voltado numa rodada anterior interrompida, e sobrescrever
      // com o mesmo original é inofensivo. Falhar por "já existe" faria a retomada travar.
      const { error } = await db.storage.from(BUCKET).upload(
        alvo.caminho,
        new Blob([bytes], { type: tipoDe(alvo.nome) }),
        { contentType: tipoDe(alvo.nome), upsert: true },
      );
      if (error) { console.error(`  ✗ ${alvo.caminho}: ${error.message}`); falhas++; continue; }
      console.log(`  ✓ ${alvo.caminho}  (${(bytes.length / 1024).toFixed(0)} KB)`);
      enviados++;
    } catch (e) {
      console.error(`  ✗ ${alvo.caminho}: ${String(e).slice(0, 120)}`);
      falhas++;
    }
  }

  console.log(`\n${aplicar ? "enviados" : "casariam"}: ${enviados}` +
    (jaExistiam ? ` | já existiam: ${jaExistiam}` : "") +
    (falhas ? ` | falhas: ${falhas}` : ""));
  if (faltando.length) {
    console.log(`\nSEM ORIGEM (${faltando.length}) — precisam ser localizados:`);
    for (const f of faltando) console.log(`  ${f}`);
  } else {
    console.log("\nnenhum arquivo faltando.");
  }
}

if (import.meta.main) await main();
