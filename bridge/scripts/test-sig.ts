const secret = Deno.env.get("EVOLUTION_HUB_WEBHOOK_SECRET")!;
const body = JSON.stringify({ object: "test_sig", entry: [] });
const enc = new TextEncoder();
const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
const r = await fetch("https://cofre.camposoberano.com.br/hub-webhook", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + hex, "X-Hub-Delivery-Id": "sigtest-" + hex.slice(0, 8) },
  body,
});
console.log("resposta bridge:", r.status, (await r.text()).slice(0, 60));
console.log("=> 200/ok = secret BATE | 401 = secret NÃO bate (esse é o bug do 5895)");
