async function t(u: string) { try { const r = await fetch(u); return r.status; } catch (e) { return "ERR " + String(e).slice(0, 40); } }
console.log("bridge health:", await t("https://cofre.camposoberano.com.br/health"));
try { console.log("bridge version:", await (await fetch("https://cofre.camposoberano.com.br/version")).text()); } catch (e) { console.log("ver ERR"); }
console.log("painel login:", await t("https://cofre.2.camposoberano.com.br/login"));
console.log("chatwoot:", await t("https://gerenciador.soberano.pro/"));
