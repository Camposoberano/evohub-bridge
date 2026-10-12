import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fetchSafeMedia,
  readLimitedMedia,
} from "../shared/safe-media-download.ts";

Deno.test("mídia revalida destino após redirecionamento antes de buscar", async () => {
  const fetched: string[] = [];
  const fakeFetch = ((url: string) => {
    fetched.push(url);
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/internal" },
      }),
    );
  }) as typeof fetch;
  await assertRejects(
    () => fetchSafeMedia("https://8.8.8.8/audio", fakeFetch),
    Error,
    "destino de mídia recusado",
  );
  assertEquals(fetched, ["https://8.8.8.8/audio"]);
});

Deno.test("download recusa corpo maior que limite mesmo sem Content-Length", async () => {
  await assertRejects(
    () => readLimitedMedia(new Response(new Uint8Array(5)), 4),
    Error,
    "mídia excede",
  );
});
