// HMAC-SHA256 helpers (Web Crypto — roda em Deno/Edge Runtime).
// IMPORTANTE: sempre valide sobre o BODY CRU (string original). Reparsear o JSON
// e re-serializar quebra a assinatura.

const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Comparação em tempo constante (evita timing attack).
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

// EVO Hub assina como "sha256=<hex>" no header X-Hub-Signature-256.
export async function verifyHubSignature(
  secret: string,
  rawBody: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const expected = "sha256=" + (await hmacSha256Hex(secret, rawBody));
  return timingSafeEqual(expected, header.trim());
}
