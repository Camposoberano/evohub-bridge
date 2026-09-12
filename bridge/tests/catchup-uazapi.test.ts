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
