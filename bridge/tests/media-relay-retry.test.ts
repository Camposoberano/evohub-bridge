import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relayProviderMedia } from "../shared/media-relay.ts";

// 28/08: 17 envios de mídia morreram porque o anexo do Chatwoot respondia 404 na primeira
// leitura (webhook chega antes do ActiveStorage servir o blob) e o bridge desistia ali.

function fetchFalso(statuses: number[], chamadas: number[]) {
  let i = 0;
  return ((_url: string | URL | Request) => {
    const status = statuses[Math.min(i, statuses.length - 1)];
    i++;
    chamadas.push(status);
    if (status === 200) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );
    }
    return Promise.resolve(new Response("nao encontrado", { status }));
  }) as typeof fetch;
}

Deno.test("404 momentâneo do Chatwoot é repetido até servir", async () => {
  const originalFetch = globalThis.fetch;
  const chamadas: number[] = [];
  globalThis.fetch = fetchFalso([404, 404, 200], chamadas);
  try {
    // O upload no Supabase não faz parte deste teste: só interessa quantas leituras houve
    // antes de o download parar de falhar.
    await relayProviderMedia("https://chatwoot.invalid/anexo.jpg").catch(() => {});
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(chamadas, [404, 404, 200]);
});

Deno.test("403 não é repetido — negativa definitiva", async () => {
  const originalFetch = globalThis.fetch;
  const chamadas: number[] = [];
  globalThis.fetch = fetchFalso([403], chamadas);
  let erro = "";
  try {
    await relayProviderMedia("https://chatwoot.invalid/anexo.jpg");
  } catch (e) {
    erro = (e as Error).message;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assertEquals(chamadas, [403]);
  assertEquals(erro, "download da mídia retornou HTTP 403");
});
