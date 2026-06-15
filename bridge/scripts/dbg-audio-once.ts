const BASE = "https://cofre.camposoberano.com.br";
const ver = await (await fetch(`${BASE}/version`)).json().catch(() => ({}));
console.log("build:", ver.build);
const r = await fetch(`${BASE}/debug-audio?url=${encodeURIComponent("https://download.samplelib.com/mp3/sample-3s.mp3")}`);
console.log(await r.text());
