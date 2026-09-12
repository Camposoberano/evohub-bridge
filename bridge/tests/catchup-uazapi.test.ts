import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  candidatasARecuperar,
  dataDaQueda,
  JANELA_PADRAO_MS,
  janelaDeBusca,
  MARGEM_WEBHOOK_MS,
  msDoTimestamp,
} from "../shared/catchup-uazapi.ts";

// 11/09: o 6836 caiu 10/09 00:41 e voltou ~11/09 03:00. As 24 mensagens de clientes desse
// intervalo entraram na uazapi pela sincronização de histórico, com a data ORIGINAL, e nunca
// passaram pelo webhook. Estes testes prendem as regras que fazem a varredura achá-las.

const H = 60 * 60 * 1000;
const agora = Date.parse("2026-09-11T04:00:00Z");

Deno.test("lastDisconnect da uazapi vem com espaço no lugar do T", () => {
  assertEquals(dataDaQueda("2026-09-10 00:41:14.921Z"), Date.parse("2026-09-10T00:41:14.921Z"));
  assertEquals(dataDaQueda(""), null);
  assertEquals(dataDaQueda(null), null);
  assertEquals(dataDaQueda("não é data"), null);
});

Deno.test("sem queda recente a janela é das últimas 6h até 10 minutos atrás", () => {
  const j = janelaDeBusca(agora, null);
  assertEquals(j.desde, agora - JANELA_PADRAO_MS);
  assertEquals(j.ate, agora - MARGEM_WEBHOOK_MS);
});

Deno.test("depois de uma queda a janela recua até ela — a sincronização traz a data antiga", () => {
  const queda = Date.parse("2026-09-10T00:41:14Z");
  const j = janelaDeBusca(agora, queda);
  assertEquals(j.desde, queda - MARGEM_WEBHOOK_MS);
  // a primeira mensagem perdida (10/09 02:08) fica dentro
  assertEquals(Date.parse("2026-09-10T02:08:58Z") >= j.desde, true);
});

Deno.test("queda com mais de 72h não estica a janela", () => {
  const j = janelaDeBusca(agora, agora - 100 * H);
  assertEquals(j.desde, agora - JANELA_PADRAO_MS);
});

Deno.test("timestamp em segundos e em milissegundos dão o mesmo instante", () => {
  assertEquals(msDoTimestamp(1757549818), 1757549818000);
  assertEquals(msDoTimestamp(1757549818000), 1757549818000);
  assertEquals(msDoTimestamp(undefined), 0);
});

Deno.test("só entra mensagem de cliente, fora de grupo, dentro da janela", () => {
  const desde = agora - 6 * H;
  const ate = agora - MARGEM_WEBHOOK_MS;
  const s = (d: number) => Math.floor(d / 1000);
  const lista = [
    { id: "a", fromMe: false, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - H) },
    { id: "nossa", fromMe: true, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - H) },
    { id: "grupo", fromMe: false, isGroup: true, chatid: "123@g.us", messageTimestamp: s(agora - H) },
    { id: "grupo2", fromMe: false, chatid: "123@g.us", messageTimestamp: s(agora - H) },
    { id: "velha", fromMe: false, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - 7 * H) },
    // chegou há 2 minutos: é do webhook; a varredura não pode passar na frente da automação
    { id: "recente", fromMe: false, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - 2 * 60_000) },
    { fromMe: false, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - H) },
  ];
  assertEquals(candidatasARecuperar(lista, desde, ate).map((m) => m.id), ["a"]);
});

// --- paginação e margem -------------------------------------------------------------------
// 11/09: com uma chamada só de limit 1000, a janela de 30h no 5895 (número movimentado)
// terminava antes do começo da janela — a varredura dizia "nada a recuperar" sem ter olhado.

import {
  buscarMensagensDaInstancia,
  MAX_PAGINAS_FIND,
  PAGINA_FIND,
} from "../shared/catchup-uazapi.ts";

/** páginas do mais novo pro mais antigo, uma mensagem por minuto */
function paginador(totalPaginas: number, fimMs: number) {
  const chamadas: number[] = [];
  return {
    chamadas,
    buscar: (_t: string, limit: number, offset: number) => {
      chamadas.push(offset);
      const pagina = Math.floor(offset / limit);
      if (pagina >= totalPaginas) return Promise.resolve({ ok: true, data: [] });
      const data = Array.from({ length: limit }, (_, i) => ({
        id: `p${pagina}-${i}`,
        messageTimestamp: Math.floor((fimMs - (offset + i) * 60_000) / 1000),
      }));
      return Promise.resolve({ ok: true, data });
    },
  };
}

Deno.test("para de paginar assim que a página alcança o começo da janela", async () => {
  const fim = Date.parse("2026-09-11T04:00:00Z");
  const p = paginador(8, fim);
  // janela de ~9h: cabe na 2ª página (500 min ≈ 8,3h)
  const r = await buscarMensagensDaInstancia("tk", fim - 9 * 60 * 60_000, p.buscar);
  assertEquals(r.ok, true);
  assertEquals(r.truncado, false);
  assertEquals(p.chamadas, [0, PAGINA_FIND]);
  assertEquals(r.lista.length, 2 * PAGINA_FIND);
});

Deno.test("uma página basta quando a instância tem pouco movimento", async () => {
  const fim = Date.parse("2026-09-11T04:00:00Z");
  const p = { chamadas: [] as number[] };
  const r = await buscarMensagensDaInstancia("tk", fim - 72 * 60 * 60_000, (_t, _l, offset) => {
    p.chamadas.push(offset);
    return Promise.resolve({ ok: true, data: [{ id: "a", messageTimestamp: fim / 1000 }] });
  });
  assertEquals(p.chamadas, [0]);
  assertEquals(r.truncado, false);
});

Deno.test("janela maior que o teto de páginas avisa que truncou", async () => {
  const fim = Date.parse("2026-09-11T04:00:00Z");
  const p = paginador(50, fim);
  const r = await buscarMensagensDaInstancia("tk", fim - 72 * 60 * 60_000, p.buscar);
  assertEquals(p.chamadas.length, MAX_PAGINAS_FIND);
  assertEquals(r.truncado, true, "quem lê o log precisa saber que sobrou mensagem de fora");
});

Deno.test("erro no meio da paginação não vira 'janela limpa'", async () => {
  const r = await buscarMensagensDaInstancia("tk", 0, () => Promise.resolve({ ok: false, data: null }));
  assertEquals(r.ok, false);
  assertEquals(r.truncado, true);
});

// A margem virou 30 min depois de medir 10,6 min de atraso real numa resposta de lista.
Deno.test("mensagem de 15 minutos atrás ainda é do webhook, não da varredura", () => {
  const agora = Date.parse("2026-09-11T04:00:00Z");
  const { desde, ate } = janelaDeBusca(agora, null);
  const s = (d: number) => Math.floor(d / 1000);
  const lista = [
    { id: "15min", fromMe: false, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - 15 * 60_000) },
    { id: "40min", fromMe: false, isGroup: false, chatid: "5542@s.whatsapp.net", messageTimestamp: s(agora - 40 * 60_000) },
  ];
  assertEquals(candidatasARecuperar(lista, desde, ate).map((m) => m.id), ["40min"]);
});
