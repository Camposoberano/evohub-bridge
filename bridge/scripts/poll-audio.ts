// Aguarda o build ffmpeg-clearenv subir e roda o /debug-audio (transcode real).
const BASE = "https://cofre.camposoberano.com.br";
const TEST = "https://download.samplelib.com/mp3/sample-3s.mp3";
for (let i = 1; i <= 18; i++) {
  let build = "?";
  try { build = (await (await fetch(`${BASE}/version`)).json()).build; } catch { /* */ }
  if (build === "2026-06-15-ffmpeg-byname") {
    console.log(`[${i}] LIVE`);
    try {
      const r = await fetch(`${BASE}/debug-audio?url=${encodeURIComponent(TEST)}`);
      console.log(await r.text());
    } catch (e) { console.log("debug err", String(e).slice(0, 120)); }
    break;
  }
  console.log(`[${i}] build: ${build}`);
  await new Promise((r) => setTimeout(r, 25000));
}
