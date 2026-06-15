try {
  const r = await fetch("https://cofre.camposoberano.com.br/version");
  const j = await r.json();
  console.log("build:", j.build, "| campaign-gated?", (j.features || []).includes("campaign-gated"), "| meta-templates?", (j.features || []).includes("meta-templates"));
} catch (e) { console.log("ERR", String(e).slice(0, 100)); }
