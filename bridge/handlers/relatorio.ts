import { admin } from "../shared/supabase.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("data");
  const hoje = dateParam || new Date().toISOString().slice(0, 10);

  const db = admin();
  const inicioUTC = `${hoje}T03:00:00.000Z`; // BRT 00:00
  const fimUTC = new Date(new Date(inicioUTC).getTime() + 86400000).toISOString();

  const { data: msgs } = await db.from("messages")
    .select("id,conversation_id,direction,msg_type,content,status,sent_at")
    .gte("sent_at", inicioUTC)
    .lt("sent_at", fimUTC)
    .order("sent_at", { ascending: true });

  const { data: convs } = await db.from("conversations")
    .select("id,contact_id,status,opened_at,chatwoot_conversation_id")
    .gte("opened_at", inicioUTC)
    .lt("opened_at", fimUTC);

  const { data: contacts } = await db.from("contacts")
    .select("id,name,external_contact_id,channel_id");

  const contactMap = new Map<string, Json>();
  for (const c of (contacts ?? [])) contactMap.set(c.id as string, c as Json);

  const convMap = new Map<string, Json>();
  for (const c of (convs ?? [])) convMap.set(c.id as string, c as Json);

  const porConv = new Map<string, Json[]>();
  for (const m of (msgs ?? [])) {
    const cid = m.conversation_id as string;
    if (!cid) continue;
    if (!porConv.has(cid)) porConv.set(cid, []);
    porConv.get(cid)!.push(m as Json);
  }

  let totalIn = 0, totalOut = 0, totalFailed = 0;
  let intentPreco = 0, intentVideo = 0, intentPlantio = 0, intentNutricao = 0;
  const semResposta: { conv: string; msg: string; ts: string }[] = [];
  const conversas: { convId: string; cwId: number | null; contato: string; telefone: string; msgs: Json[]; resumo: string }[] = [];

  for (const [convId, mensagens] of porConv) {
    const conv = convMap.get(convId);
    const contactId = conv?.contact_id as string | undefined;
    const contact = contactId ? contactMap.get(contactId) : undefined;
    const nome = (contact?.name as string) || "Desconhecido";
    const tel = (contact?.external_contact_id as string) || "?";
    const cwId = (conv?.chatwoot_conversation_id as number) ?? null;

    let convIn = 0, convOut = 0;
    const resumoLinhas: string[] = [];

    for (const m of mensagens) {
      const dir = m.direction as string;
      if (dir === "in") { totalIn++; convIn++; }
      else if (dir === "out") { totalOut++; convOut++; }
      if (m.status === "failed") totalFailed++;

      const content = (m.content as string) || "";

      if (dir === "out") {
        if (content.includes("Preparei 5 vídeos") || content.includes("Separei 5 vídeos")) intentVideo++;
        if (content.includes("Lista de temas de plantio")) intentPlantio++;
        if (content.includes("Lista de info nutricional") || content.includes("Análise Bromatológica")) intentNutricao++;
        if (content.includes("imagem preco_") || content.includes("Tabela de preços")) intentPreco++;
      }

      const hora = (m.sent_at as string || "").slice(11, 16);
      const emoji = dir === "in" ? "👤" : "🤖";
      const tipo = m.msg_type as string;
      const statusIcon = m.status === "failed" ? " ❌" : "";
      const texto = content.slice(0, 150).replace(/\n/g, " ");
      resumoLinhas.push(`${hora} ${emoji} [${tipo}]${statusIcon} ${texto}`);
    }

    // msgs sem resposta do bot
    let lastIn: Json | null = null;
    for (const m of mensagens) {
      if ((m.direction as string) === "in") lastIn = m;
      else if ((m.direction as string) === "out") lastIn = null;
    }
    if (lastIn && convIn > 0 && convOut === 0) {
      semResposta.push({
        conv: convId.slice(0, 8),
        msg: ((lastIn.content as string) || "").slice(0, 100),
        ts: ((lastIn.sent_at as string) || "").slice(11, 16),
      });
    }

    conversas.push({
      convId: convId.slice(0, 8),
      cwId,
      contato: nome,
      telefone: tel.slice(-4),
      msgs: mensagens,
      resumo: resumoLinhas.join("\n"),
    });
  }

  conversas.sort((a, b) => b.msgs.length - a.msgs.length);

  const html = renderHTML(hoje, {
    totalConvs: porConv.size,
    novasConvs: convs?.length ?? 0,
    totalIn,
    totalOut,
    totalFailed,
    intentPreco,
    intentVideo,
    intentPlantio,
    intentNutricao,
    semResposta,
    conversas,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

interface ReportData {
  totalConvs: number;
  novasConvs: number;
  totalIn: number;
  totalOut: number;
  totalFailed: number;
  intentPreco: number;
  intentVideo: number;
  intentPlantio: number;
  intentNutricao: number;
  semResposta: { conv: string; msg: string; ts: string }[];
  conversas: { convId: string; cwId: number | null; contato: string; telefone: string; msgs: Json[]; resumo: string }[];
}

function renderHTML(data: string, r: ReportData): string {
  const semRespostaHTML = r.semResposta.length === 0
    ? `<p style="color:#27ae60">✅ Todas as conversas tiveram resposta do bot</p>`
    : r.semResposta.map(s => `<div class="alerta">⚠️ Conv ${s.conv} (${s.ts}) — "${s.msg}"</div>`).join("\n");

  const convsHTML = r.conversas.map(c => `
    <details class="conv">
      <summary>
        <strong>${c.contato}</strong> (****${c.telefone})
        ${c.cwId ? `<span class="tag">CW #${c.cwId}</span>` : ""}
        <span class="tag">${c.msgs.length} msgs</span>
      </summary>
      <pre class="chat">${escapeHtml(c.resumo)}</pre>
    </details>
  `).join("\n");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório ${data} — Campo Soberano</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; color: #333; padding: 20px; max-width: 900px; margin: 0 auto; }
  h1 { color: #2d6a1e; margin-bottom: 5px; }
  .subtitle { color: #666; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: white; border-radius: 10px; padding: 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .card .num { font-size: 2rem; font-weight: bold; color: #2d6a1e; }
  .card .label { font-size: .85rem; color: #666; }
  .card.danger .num { color: #e74c3c; }
  .section { background: white; border-radius: 10px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .section h2 { color: #2d6a1e; margin-bottom: 12px; font-size: 1.1rem; }
  .alerta { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 14px; margin-bottom: 8px; border-radius: 4px; font-size: .9rem; }
  .conv { margin-bottom: 8px; }
  .conv summary { cursor: pointer; padding: 10px; background: #f9f9f9; border-radius: 6px; font-size: .95rem; }
  .conv summary:hover { background: #eef5ee; }
  .tag { background: #e8f5e9; color: #2d6a1e; padding: 2px 8px; border-radius: 12px; font-size: .75rem; margin-left: 6px; }
  .chat { background: #1a1a2e; color: #eee; padding: 14px; border-radius: 6px; font-size: .8rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin-top: 8px; overflow-x: auto; }
  .nav { margin-bottom: 16px; display: flex; gap: 10px; align-items: center; }
  .nav a { color: #2d6a1e; text-decoration: none; font-weight: bold; padding: 6px 14px; border: 1px solid #2d6a1e; border-radius: 6px; }
  .nav a:hover { background: #2d6a1e; color: white; }
  .intents { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
  .intent { background: #f0f7f0; padding: 10px; border-radius: 8px; text-align: center; }
  .intent .num { font-size: 1.4rem; font-weight: bold; color: #2d6a1e; }
  .intent .label { font-size: .8rem; color: #555; }
</style>
</head>
<body>
<h1>📊 Relatório do Dia</h1>
<p class="subtitle">${data} — Campo Soberano / Mega Sorgo</p>

<div class="nav">
  <a href="?data=${prevDay(data)}">← Anterior</a>
  <a href="?data=${nextDay(data)}">Próximo →</a>
  <a href="?">Hoje</a>
</div>

<div class="cards">
  <div class="card"><div class="num">${r.novasConvs}</div><div class="label">Conversas novas</div></div>
  <div class="card"><div class="num">${r.totalConvs}</div><div class="label">Conversas ativas</div></div>
  <div class="card"><div class="num">${r.totalIn}</div><div class="label">Msgs recebidas</div></div>
  <div class="card"><div class="num">${r.totalOut}</div><div class="label">Msgs enviadas</div></div>
  <div class="card ${r.totalFailed > 0 ? "danger" : ""}"><div class="num">${r.totalFailed}</div><div class="label">Falhas envio</div></div>
  <div class="card ${r.semResposta.length > 0 ? "danger" : ""}"><div class="num">${r.semResposta.length}</div><div class="label">Sem resposta</div></div>
</div>

<div class="section">
  <h2>🎯 Intents Disparadas</h2>
  <div class="intents">
    <div class="intent"><div class="num">${r.intentPreco}</div><div class="label">💰 Preço</div></div>
    <div class="intent"><div class="num">${r.intentVideo}</div><div class="label">🎬 Vídeo</div></div>
    <div class="intent"><div class="num">${r.intentPlantio}</div><div class="label">🌱 Plantio</div></div>
    <div class="intent"><div class="num">${r.intentNutricao}</div><div class="label">🧪 Nutrição</div></div>
  </div>
</div>

<div class="section">
  <h2>⚠️ Sem Resposta do Bot</h2>
  ${semRespostaHTML}
</div>

<div class="section">
  <h2>💬 Conversas (${r.conversas.length})</h2>
  ${convsHTML}
</div>

<p style="text-align:center;color:#999;margin-top:20px;font-size:.8rem">Gerado em ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC</p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function prevDay(d: string): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function nextDay(d: string): string {
  const dt = new Date(d + "T12:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
