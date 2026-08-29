import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { anexoUsaTokenDoCanal } from "../handlers/sync-facebook.ts";

// Anexo do Instagram é servido pelo próprio gateway (api.evohub.ai) e exige o token do canal;
// sem o header vinha 401 e a mídia era perdida. O token não pode vazar para outros hosts.

Deno.test("anexo servido pelo Hub recebe o token do canal", () => {
  assertEquals(
    anexoUsaTokenDoCanal("https://api.evohub.ai/attachments/abc", "https://api.evohub.ai"),
    true,
  );
});

Deno.test("CDN da Meta não recebe o token do canal", () => {
  assertEquals(
    anexoUsaTokenDoCanal(
      "https://scontent.xx.fbcdn.net/v/t1.15752-9/foto.jpg",
      "https://api.evohub.ai",
    ),
    false,
  );
  assertEquals(
    anexoUsaTokenDoCanal("https://lookaside.fbsbx.com/x", "https://api.evohub.ai"),
    false,
  );
});

Deno.test("URL inválida não vaza token", () => {
  assertEquals(anexoUsaTokenDoCanal("nao-e-url", "https://api.evohub.ai"), false);
});
