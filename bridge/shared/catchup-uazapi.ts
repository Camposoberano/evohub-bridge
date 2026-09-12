// catchup-uazapi — busca na uazapi a entrada de cliente que não chegou pelo webhook.
//
// Em 11/09 o 6836 ficou desconectado de 10/09 00:41 a 11/09 ~03:00. O que os clientes
// mandaram nesse intervalo chegou no aparelho e entrou na uazapi pela sincronização de
// histórico, na reconexão — e sincronização de histórico não dispara webhook. Resultado:
// 24 mensagens de 7 clientes (uma compra sendo fechada, um pedido de rastreio) fora do banco e
// fora do Chatwoot. Ninguém viu. Foram recuperadas à mão com o script de backfill; este módulo
// faz a mesma coisa sozinho, a cada rodada.
//
// Três regras que não são detalhe:
//
// 1. A janela recua até a ÚLTIMA QUEDA da instância (`lastDisconnect` do /instance/all), não
//    até a rodada anterior: a mensagem sincronizada chega com a data em que o cliente mandou,
//    horas antes. Uma varredura "de onde parei para frente" nunca a veria.
// 2. Só entra o que tem mais de 30 minutos (ver MARGEM_WEBHOOK_MS). Se a varredura
//    gravasse antes do webhook, ele bateria no claim, veria "duplicate" e pularia a
//    automação — o bot deixaria de responder uma mensagem que chegou normalmente.
// 3. Grava pelo `ingestInbound` direto, sem automação: resposta automática para quem escreveu
//    há horas é pior que nenhuma. Quem responde é o atendente — por isso o monitor avisa.
import type { DbClient } from "./supabase.ts";
import { releaseDelivery } from "./supabase.ts";
import { accountForChannel } from "./accounts.ts";
import { ingestInbound, type InboundAttachment } from "./inbound.ts";
import { adminGet, instPost, uazapiConfigured } from "./uazapi.ts";
import { consultaEmLotes } from "./lotes.ts";

type Json = Record<string, unknown>;

const MIN = 60_000;
const H = 60 * MIN;
/**
 * Quanto a varredura espera antes de encostar numa mensagem.
 *
 * Medido em 11/09 (339 mensagens de cliente em 30h): o caminho normal entrega em 3s na
 * mediana e 30s no p90, mas UMA resposta de lista levou 10,6 min entre o WhatsApp e o banco.
 * Se a varredura gravar antes do webhook, o webhook bate no claim, vê "duplicate" e pula a
 * automação — o funil não reage ao clique do cliente. 30 min deixa folga de 3x sobre o pior
 * caso observado; o preço é a mensagem realmente perdida aparecer até 45 min depois (30 de
 * margem + a rodada de 15), em vez de nunca.
 */
export const MARGEM_WEBHOOK_MS = 30 * MIN;
export const JANELA_PADRAO_MS = 6 * H;
export const JANELA_MAXIMA_MS = 72 * H;
/** Página do /message/find. A janela longa não cabe numa só num número movimentado. */
export const PAGINA_FIND = 500;
/** Teto de páginas por instância: 4.000 mensagens cobrem 72h até no 5895. */
export const MAX_PAGINAS_FIND = 8;
const MAX_BYTES = 15 * 1024 * 1024;

/** A uazapi manda `messageTimestamp` ora em segundos, ora em milissegundos. */
export function msDoTimestamp(valor: unknown): number {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? n : n * 1000;
}

/** `lastDisconnect` vem como "2026-09-10 00:41:14.921Z" (espaço, não "T"), ou vazio. */
export function dataDaQueda(valor: unknown): number | null {
  const s = String(valor ?? "").trim();
  if (!s) return null;
  const ms = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Janela da varredura: das últimas 6h, ou desde a última queda se ela foi nas últimas 72h —
 * o que vier antes — até a margem do webhook atrás (30 min).
 */
export function janelaDeBusca(
  agora: number,
  ultimaQueda: number | null,
): { desde: number; ate: number } {
  const ate = agora - MARGEM_WEBHOOK_MS;
  let desde = agora - JANELA_PADRAO_MS;
  if (ultimaQueda != null && ultimaQueda > agora - JANELA_MAXIMA_MS) {
    desde = Math.min(desde, ultimaQueda - MARGEM_WEBHOOK_MS);
  }
  return { desde, ate };
}

/** Mensagens de cliente (não nossas, não de grupo) dentro da janela. */
export function candidatasARecuperar(
  lista: Json[],
  desde: number,
  ate: number,
): Json[] {
  return lista.filter((m) => {
    if (m.fromMe !== false) return false;
    if (m.isGroup === true || String(m.chatid ?? "").includes("@g.us")) return false;
    if (typeof m.id !== "string" || !m.id) return false;
    const t = msDoTimestamp(m.messageTimestamp);
    return t >= desde && t <= ate;
  });
}

function instanciaConectada(status: unknown): boolean {
  return /^(connected|open)$/i.test(String(status ?? "").trim());
}

/**
 * Busca as mensagens da instância até cobrir o começo da janela.
 *
 * Uma chamada só de `limit: 1000` não alcança 30h no 5895 (196 mensagens de cliente na janela
 * e a lista terminava antes do início dela). O `/message/find` devolve do mais novo para o
 * mais antigo, então dá para parar assim que a página alcançar `desde` — quem tem pouco
 * movimento resolve na primeira página.
 *
 * `truncado` é o que sobrou de fora: existe para o log dizer que a varredura não viu tudo,
 * em vez de fingir que a janela estava limpa.
 */
export async function buscarMensagensDaInstancia(
  token: string,
  desde: number,
  buscar: (
    token: string,
    limit: number,
    offset: number,
  ) => Promise<{ ok: boolean; data: unknown }> = (t, limit, offset) =>
    instPost("/message/find", t, { limit, offset }),
): Promise<{ ok: boolean; lista: Json[]; truncado: boolean }> {
  const lista: Json[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS_FIND; pagina++) {
    const r = await buscar(token, PAGINA_FIND, pagina * PAGINA_FIND);
    if (!r.ok) return { ok: false, lista, truncado: true };
    const lote = (Array.isArray(r.data)
      ? r.data
      : ((r.data as Json)?.messages ?? [])) as Json[];
    lista.push(...lote);
    if (lote.length < PAGINA_FIND) return { ok: true, lista, truncado: false };
    const maisAntiga = Math.min(
      ...lote.map((m) => msDoTimestamp(m.messageTimestamp)).filter(Boolean),
    );
    if (Number.isFinite(maisAntiga) && maisAntiga <= desde) {
      return { ok: true, lista, truncado: false };
    }
  }
  return { ok: true, lista, truncado: true };
}

function isMedia(tipo: string): boolean {
  return /Audio|Image|Video|Document|Sticker/i.test(tipo);
}

// Mesmo caminho do webhook: bytes descriptografados pela própria uazapi.
async function baixarMidia(
  token: string,
  messageId: string,
  tipo: string,
): Promise<InboundAttachment[] | undefined> {
  try {
    const r = await instPost("/message/download", token, {
      id: messageId,
      return_base64: true,
      return_link: false,
      generate_mp3: /audio|ptt/i.test(tipo),
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
      (/audio|ptt/i.test(tipo) ? "audio/mpeg" : "application/octet-stream");
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

// Canal ATIVO da instância. Canal inativo fica de fora de propósito: o Mato Grosso continua
// na nossa conta uazapi, mas desde 11/09 é de outro projeto.
async function canalAtivoDaInstancia(db: DbClient, nome: string): Promise<Json | null> {
  for (const coluna of ["external_id", "name"]) {
    const { data, error } = await db.from("channels").select("*")
      .eq(coluna, nome).eq("type", "whatsapp").maybeSingle();
    if (error) throw error;
    if (data) {
      const status = String((data as Json).status ?? "");
      return status === "active" || status === "connected" ? data as Json : null;
    }
  }
  return null;
}

export type ResultadoCatchup = {
  instancia: string;
  canal: string;
  desde: string;
  ate: string;
  candidatas: number;
  recuperadas: number;
  puladas: number;
  falhas: number;
  /** a lista da uazapi não alcançou o começo da janela (limite de mensagens) */
  truncado: boolean;
  /** só na simulação: o que seria gravado */
  amostras?: string[];
};

export async function recuperarEntradaUazapi(
  db: DbClient,
  opts: {
    apply: boolean;
    agora?: number;
    janelaFixa?: { desde: number; ate: number };
  },
): Promise<ResultadoCatchup[]> {
  if (!uazapiConfigured()) return [];
  const agora = opts.agora ?? Date.now();
  const r = await adminGet("/instance/all");
  const instancias = Array.isArray(r.data) ? r.data as Json[] : [];
  if (!instancias.length) {
    // 401, corpo inesperado ou uazapi fora: some em silêncio seria "nada a recuperar".
    console.warn("uazapi-catchup: /instance/all sem instâncias, HTTP", r.status);
    return [];
  }
  const resultados: ResultadoCatchup[] = [];

  for (const inst of instancias) {
    const nome = String(inst.name ?? "");
    const token = String(inst.token ?? "");
    if (!nome || !token || !instanciaConectada(inst.status)) continue;
    // Uma instância problemática (dois canais com o mesmo nome, banco oscilando) não pode
    // derrubar a varredura das outras — quem depende dela é justamente quem acabou de voltar.
    let canal: Json | null = null;
    try {
      canal = await canalAtivoDaInstancia(db, nome);
    } catch (e) {
      console.error("uazapi-catchup: canal da instância", nome, String(e).slice(0, 140));
      continue;
    }
    if (!canal) continue;

    const { desde, ate } = opts.janelaFixa ??
      janelaDeBusca(agora, dataDaQueda(inst.lastDisconnect));
    const res: ResultadoCatchup = {
      instancia: nome,
      canal: String(canal.name ?? ""),
      desde: new Date(desde).toISOString(),
      ate: new Date(ate).toISOString(),
      candidatas: 0,
      recuperadas: 0,
      puladas: 0,
      falhas: 0,
      truncado: false,
    };
    resultados.push(res);

    const find = await buscarMensagensDaInstancia(token, desde);
    if (!find.ok) {
      res.falhas++;
      continue;
    }
    const lista = find.lista;
    res.truncado = find.truncado;

    const candidatas = candidatasARecuperar(lista, desde, ate);
    res.candidatas = candidatas.length;
    if (!candidatas.length) continue;

    let perdidas: Json[];
    try {
      const gravadas = new Set(
        (await consultaEmLotes<{ meta_message_id: unknown }>(
          candidatas.map((m) => m.id),
          (lote) => db.from("messages").select("meta_message_id").in("meta_message_id", lote),
        )).map((m) => String(m.meta_message_id)),
      );
      perdidas = candidatas.filter((m) => !gravadas.has(String(m.id)));
    } catch (e) {
      // Falha de leitura não é "nada gravado": reingerir tudo criaria duplicata.
      res.falhas++;
      console.error("uazapi-catchup: consulta de já gravadas", nome, String(e).slice(0, 140));
      continue;
    }
    if (!perdidas.length) continue;

    if (!opts.apply) {
      res.amostras = perdidas.map((m) =>
        `${new Date(msDoTimestamp(m.messageTimestamp)).toISOString()} ` +
        `…${String(m.chatid ?? "").replace(/@.*$/, "").slice(-4)} ${String(m.messageType ?? "")}`
      );
      res.recuperadas = perdidas.length;
      continue;
    }

    const acct = await accountForChannel(String(canal.id));
    for (const m of perdidas) {
      const id = String(m.id);
      const tipo = String(m.messageType ?? "text");
      const de = String(m.chatid ?? "").replace(/@.*$/, "");
      if (!de) {
        res.puladas++;
        continue;
      }
      try {
        // Claim sem linha em `messages` é ingestão que morreu no meio; com 30 minutos de
        // margem o webhook já terminou, então soltar o claim não abre corrida.
        await releaseDelivery(db, `wa-${canal.id}-${id}`);
        const anexos = isMedia(tipo)
          ? await baixarMidia(token, String(m.messageid ?? id), tipo)
          : undefined;
        const ingest = await ingestInbound(db, canal, {
          from: de,
          name: (m.senderName as string | undefined) ?? undefined,
          metaMessageId: id,
          msgType: tipo,
          content: String(m.text ?? (m.content as Json | undefined)?.text ?? ""),
          attachments: anexos,
          sentAt: new Date(msDoTimestamp(m.messageTimestamp)).toISOString(),
          acct,
        });
        if (ingest.inserted) res.recuperadas++;
        else res.puladas++;
      } catch (e) {
        res.falhas++;
        console.error("uazapi-catchup: falha ao recuperar", nome, String(e).slice(0, 160));
      }
    }

    if (res.recuperadas > 0) {
      // vira alerta no monitor: alguém precisa responder essas conversas
      await db.from("events").insert({
        source: "catchup",
        event_type: "inbound_recovered",
        channel_id: canal.id,
        payload: {
          instancia: nome,
          canal: res.canal,
          recuperadas: res.recuperadas,
          desde: res.desde,
          ate: res.ate,
        },
      }).then(() => {}, () => {});
    }
  }
  return resultados;
}
