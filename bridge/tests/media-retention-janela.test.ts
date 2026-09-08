import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lerBuckets } from "../handlers/media-retention.ts";

// O que os dois buckets guardam não vale o mesmo. `chatwoot-media` é o áudio, a foto e o
// documento que o CLIENTE mandou — histórico de atendimento, e o dono da conta decidiu que
// fica. `soberano-out` é o PTT que NÓS geramos pra disparar: material de campanha, e desde
// o nome por hash é reproduzível — apagar só força um upload novo.
//
// Uma janela única obrigaria a escolher entre perder conversa de cliente ou carregar
// gigabytes de campanha para sempre.

Deno.test("janela por bucket, cada um com o seu prazo", () => {
  assertEquals(lerBuckets("chatwoot-media:365,soberano-out:7", 30), [
    { bucket: "chatwoot-media", dias: 365 },
    { bucket: "soberano-out", dias: 7 },
  ]);
});

Deno.test("bucket sem prazo herda o padrão", () => {
  assertEquals(lerBuckets("chatwoot-media,soberano-out:7", 30), [
    { bucket: "chatwoot-media", dias: 30 },
    { bucket: "soberano-out", dias: 7 },
  ]);
});

Deno.test("espaços em volta não viram nome de bucket", () => {
  assertEquals(lerBuckets(" chatwoot-media : 90 , soberano-out : 7 ", 30), [
    { bucket: "chatwoot-media", dias: 90 },
    { bucket: "soberano-out", dias: 7 },
  ]);
});

// Um prazo quebrado não pode virar NaN: dependendo da comparação isso apagaria tudo ou
// nada, e sem ninguém entender o motivo.
Deno.test("prazo inválido cai no padrão em vez de virar NaN", () => {
  assertEquals(lerBuckets("chatwoot-media:abc", 30), [{ bucket: "chatwoot-media", dias: 30 }]);
  assertEquals(lerBuckets("chatwoot-media:0", 30), [{ bucket: "chatwoot-media", dias: 30 }]);
  assertEquals(lerBuckets("chatwoot-media:-5", 30), [{ bucket: "chatwoot-media", dias: 30 }]);
});

Deno.test("entrada vazia não cria bucket fantasma", () => {
  assertEquals(lerBuckets("chatwoot-media,,", 30), [{ bucket: "chatwoot-media", dias: 30 }]);
  assertEquals(lerBuckets("", 30), []);
});
