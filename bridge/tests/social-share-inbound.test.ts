import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  conteudoDeEntrada,
  extractShareLinks,
} from "../handlers/sync-facebook.ts";

// Reel/post compartilhado no direct do Instagram não vem em `message` nem em `attachments`:
// vem em `shares`. Sem pedir esse campo a mensagem chegava vazia e virava "[anexo]" com
// msg_type "unknown" — 100% das entradas do sorgo brasileiro estavam assim.

const SHARE = {
  message: "",
  shares: { data: [{ link: "https://www.instagram.com/reel/DcLtlxmuM-f/" }] },
};

Deno.test("extrai o link do reel compartilhado", () => {
  assertEquals(extractShareLinks(SHARE), [
    "https://www.instagram.com/reel/DcLtlxmuM-f/",
  ]);
  assertEquals(extractShareLinks({ message: "oi" }), []);
  assertEquals(extractShareLinks({ shares: { data: [{}] } }), []);
});

Deno.test("compartilhamento vira conteúdo com o link, não [anexo]", () => {
  assertEquals(
    conteudoDeEntrada(SHARE, "unknown"),
    "🔗 Compartilhou: https://www.instagram.com/reel/DcLtlxmuM-f/",
  );
});

Deno.test("vários compartilhamentos entram um por linha", () => {
  const varios = {
    message: "",
    shares: { data: [{ link: "https://a/1" }, { link: "https://a/2" }] },
  };
  assertEquals(
    conteudoDeEntrada(varios, "unknown"),
    "🔗 Compartilhou 2 itens:\nhttps://a/1\nhttps://a/2",
  );
});

Deno.test("texto do cliente continua tendo prioridade sobre o share", () => {
  assertEquals(
    conteudoDeEntrada({ ...SHARE, message: "  quanto custa?  " }, "unknown"),
    "quanto custa?",
  );
});

Deno.test("sem texto e sem share mantém o rótulo do tipo", () => {
  assertEquals(conteudoDeEntrada({ message: "" }, "image"), "[imagem]");
  assertEquals(conteudoDeEntrada({}, "unknown"), "[anexo]");
});
