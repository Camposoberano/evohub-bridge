import { admin } from "../shared/supabase.ts";

type Json = Record<string, unknown>;

export async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("data");
  const hoje = dateParam || new Date().toISOString().slice(0, 10);

  const db = admin();
  const inicioUTC = `${hoje}T03:00:00.000Z`;
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
  let funilEnroll = 0, funilPedidoPreco = 0, funilPagamento = 0;
  const semResposta: { conv: string; contato: string; msg: string; ts: string }[] = [];
  const msgsIgnoradas: { conv: string; contato: string; msg: string; ts: string }[] = [];
  const reacoesNegativas: { conv: string; contato: string; msg: string; contexto: string }[] = [];
  const perguntasSemIntent: { msg: string; count: number }[] = [];
  const perguntasMap = new Map<string, number>();

  const conversas: ConvReport[] = [];

  for (const [convId, mensagens] of porConv) {
    const conv = convMap.get(convId);
    const contactId = conv?.contact_id as string | undefined;
    const contact = contactId ? contactMap.get(contactId) : undefined;
    const nome = (contact?.name as string) || "Desconhecido";
    const tel = (contact?.external_contact_id as string) || "?";
    const cwId = (conv?.chatwoot_conversation_id as number) ?? null;

    let convIn = 0, convOut = 0;
    let teveFunil = false, tevePreco = false, tevePagamento = false;
    let teveVideo = false, tevePlantio = false, teveNutricao = false;
    const resumoLinhas: string[] = [];
    const etapas: string[] = [];
    let ultimoBot = "";

    for (let i = 0; i < mensagens.length; i++) {
      const m = mensagens[i];
      const dir = m.direction as string;
      const content = (m.content as string) || "";

      if (dir === "in") { totalIn++; convIn++; }
      else if (dir === "out") { totalOut++; convOut++; }
      if (m.status === "failed") totalFailed++;

      if (dir === "out") {
        ultimoBot = content;
        if (content.includes("Preparei 5 vídeos") || content.includes("Separei 5 vídeos")) { intentVideo++; teveVideo = true; etapas.push("video"); }
        if (content.includes("Lista de temas de plantio")) { intentPlantio++; tevePlantio = true; etapas.push("plantio"); }
        if (content.includes("Lista de info nutricional") || content.includes("Análise Bromatológica")) { intentNutricao++; teveNutricao = true; etapas.push("nutricao"); }
        if (content.includes("imagem preco_") || content.includes("Tabela de preços")) { intentPreco++; tevePreco = true; etapas.push("preco"); }
        if (content.includes("Cícero Sobreira") || content.includes("Campo Soberano")) { teveFunil = true; funilEnroll++; etapas.push("funil"); }
        if (content.includes("pag_pix") || content.includes("PIX") || content.includes("Boleto")) { tevePagamento = true; funilPagamento++; etapas.push("pagamento"); }
      }

      if (dir === "in" && content.trim()) {
        const nextOut = mensagens.slice(i + 1).find(x => (x.direction as string) === "out");
        if (!nextOut && convOut > 0) {
          msgsIgnoradas.push({ conv: convId.slice(0, 8), contato: nome, msg: content.slice(0, 100), ts: ((m.sent_at as string) || "").slice(11, 16) });
        }

        const lower = content.toLowerCase();
        if (lower.includes("não") || lower.includes("nao") || lower.includes("parar") || lower.includes("chega") || lower.includes("spam")) {
          reacoesNegativas.push({ conv: convId.slice(0, 8), contato: nome, msg: content.slice(0, 100), contexto: ultimoBot.slice(0, 80) });
        }

        if (convOut === 0 && content.length > 2 && !content.startsWith("[")) {
          const key = content.toLowerCase().trim().slice(0, 50);
          perguntasMap.set(key, (perguntasMap.get(key) || 0) + 1);
        }
      }

      const hora = (m.sent_at as string || "").slice(11, 16);
      const emoji = dir === "in" ? "👤" : "🤖";
      const tipo = m.msg_type as string;
      const statusIcon = m.status === "failed" ? " ❌" : "";
      const texto = content.slice(0, 150).replace(/\n/g, " ");
      resumoLinhas.push(`${hora} ${emoji} [${tipo}]${statusIcon} ${texto}`);
    }

    if (tevePreco) funilPedidoPreco++;

    let lastIn: Json | null = null;
    for (const m of mensagens) {
      if ((m.direction as string) === "in") lastIn = m;
      else if ((m.direction as string) === "out") lastIn = null;
    }
    if (lastIn && convIn > 0 && convOut === 0) {
      semResposta.push({
        conv: convId.slice(0, 8), contato: nome,
        msg: ((lastIn.content as string) || "").slice(0, 100),
        ts: ((lastIn.sent_at as string) || "").slice(11, 16),
      });
    }

    let statusConv: "converteu" | "engajou" | "ignorou" | "perdeu" = "ignorou";
    if (tevePagamento) statusConv = "converteu";
    else if (tevePreco || teveVideo || tevePlantio || teveNutricao) statusConv = "engajou";
    else if (convOut > 0 && convIn > 0) statusConv = "engajou";
    if (convIn > 2 && convOut === 0) statusConv = "perdeu";

    conversas.push({
      convId: convId.slice(0, 8), cwId, contato: nome, telefone: tel.slice(-4),
      msgs: mensagens, resumo: resumoLinhas.join("\n"), etapas,
      status: statusConv, totalIn: convIn, totalOut: convOut,
    });
  }

  for (const [msg, count] of perguntasMap) {
    if (count >= 1) perguntasSemIntent.push({ msg, count });
  }
  perguntasSemIntent.sort((a, b) => b.count - a.count);

  conversas.sort((a, b) => b.msgs.length - a.msgs.length);

  const recomendacoes = gerarRecomendacoes({
    totalIn, totalOut, totalFailed, semResposta, msgsIgnoradas,
    reacoesNegativas, perguntasSemIntent, conversas,
    intentPreco, intentVideo, intentPlantio, intentNutricao,
    funilEnroll, funilPedidoPreco, funilPagamento,
  });

  const html = renderHTML(hoje, {
    totalConvs: porConv.size,
    novasConvs: convs?.length ?? 0,
    totalIn, totalOut, totalFailed,
    intentPreco, intentVideo, intentPlantio, intentNutricao,
    funilEnroll, funilPedidoPreco, funilPagamento,
    semResposta, msgsIgnoradas, reacoesNegativas, perguntasSemIntent,
    conversas, recomendacoes,
  });

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

interface ConvReport {
  convId: string; cwId: number | null; contato: string; telefone: string;
  msgs: Json[]; resumo: string; etapas: string[];
  status: "converteu" | "engajou" | "ignorou" | "perdeu";
  totalIn: number; totalOut: number;
}

interface Recomendacao {
  tipo: "erro" | "atencao" | "acerto";
  titulo: string;
  detalhe: string;
  acao: string;
}

function gerarRecomendacoes(d: {
  totalIn: number; totalOut: number; totalFailed: number;
  semResposta: { conv: string; contato: string; msg: string; ts: string }[];
  msgsIgnoradas: { conv: string; contato: string; msg: string; ts: string }[];
  reacoesNegativas: { conv: string; contato: string; msg: string; contexto: string }[];
  perguntasSemIntent: { msg: string; count: number }[];
  conversas: ConvReport[];
  intentPreco: number; intentVideo: number; intentPlantio: number; intentNutricao: number;
  funilEnroll: number; funilPedidoPreco: number; funilPagamento: number;
}): Recomendacao[] {
  const recs: Recomendacao[] = [];

  if (d.semResposta.length > 0) {
    recs.push({
      tipo: "erro", titulo: `${d.semResposta.length} conversa(s) sem nenhuma resposta do bot`,
      detalhe: `Clientes mandaram mensagem e o bot não respondeu nada. Mensagens: ${d.semResposta.map(s => `"${s.msg}"`).join(", ")}`,
      acao: "Verificar se o funil auto-enroll está ativo. Considerar adicionar resposta padrão para mensagens genéricas (Oi, Olá).",
    });
  }

  if (d.msgsIgnoradas.length > 0) {
    const exemplos = d.msgsIgnoradas.slice(0, 5).map(m => `"${m.msg}" (${m.contato})`).join(", ");
    recs.push({
      tipo: "atencao", titulo: `${d.msgsIgnoradas.length} mensagem(ns) do cliente ficaram sem resposta`,
      detalhe: `Após o bot responder, o cliente mandou algo e o bot não continuou. Exemplos: ${exemplos}`,
      acao: "Avaliar se são perguntas que precisam de intent nova ou se o humano (Cícero) deve assumir.",
    });
  }

  if (d.reacoesNegativas.length > 0) {
    recs.push({
      tipo: "erro", titulo: `${d.reacoesNegativas.length} reação negativa detectada`,
      detalhe: d.reacoesNegativas.map(r => `${r.contato}: "${r.msg}" (após bot enviar: "${r.contexto}")`).join("; "),
      acao: "Revisar o texto/sequência que gerou reação negativa. Pode estar sendo invasivo ou repetitivo.",
    });
  }

  if (d.totalFailed > 0) {
    recs.push({
      tipo: "erro", titulo: `${d.totalFailed} mensagem(ns) falharam no envio`,
      detalhe: "Mensagens que a API do WhatsApp rejeitou (vídeo grande, número inválido, janela fechada).",
      acao: "Verificar logs do bridge. Se for vídeo, comprimir. Se for janela, usar template.",
    });
  }

  if (d.perguntasSemIntent.length > 0) {
    const top = d.perguntasSemIntent.slice(0, 5).map(p => `"${p.msg}" (${p.count}x)`).join(", ");
    recs.push({
      tipo: "atencao", titulo: "Perguntas que o bot não sabe responder",
      detalhe: `Mensagens recebidas sem nenhuma intent: ${top}`,
      acao: "Considerar criar intents novas para as perguntas mais frequentes.",
    });
  }

  const perdidos = d.conversas.filter(c => c.status === "perdeu");
  if (perdidos.length > 0) {
    recs.push({
      tipo: "erro", titulo: `${perdidos.length} lead(s) perdido(s)`,
      detalhe: `Clientes que mandaram mensagens mas não receberam nada do bot: ${perdidos.map(p => p.contato).join(", ")}`,
      acao: "Esses leads vieram de anúncio? Verificar se o auto-enroll está funcionando para o canal.",
    });
  }

  if (d.funilEnroll > 0 && d.funilPedidoPreco > 0) {
    const taxaPreco = Math.round((d.funilPedidoPreco / d.funilEnroll) * 100);
    if (taxaPreco >= 30) {
      recs.push({
        tipo: "acerto", titulo: `${taxaPreco}% dos leads pediram preço`,
        detalhe: `${d.funilPedidoPreco} de ${d.funilEnroll} leads que entraram no funil pediram preço.`,
        acao: "Taxa boa! O funil de apresentação está funcionando.",
      });
    } else {
      recs.push({
        tipo: "atencao", titulo: `Só ${taxaPreco}% dos leads pediram preço`,
        detalhe: `${d.funilPedidoPreco} de ${d.funilEnroll} leads. Muitos abandonam antes de pedir preço.`,
        acao: "Revisar a mensagem de apresentação — pode estar longa ou confusa. Testar CTA mais direto.",
      });
    }
  }

  if (d.funilPedidoPreco > 0 && d.funilPagamento === 0) {
    recs.push({
      tipo: "atencao", titulo: "Nenhum lead chegou na etapa de pagamento",
      detalhe: `${d.funilPedidoPreco} pediram preço mas ninguém clicou em pagamento.`,
      acao: "Revisar os textos de preço e CTA. O preço pode estar alto ou a apresentação não convence.",
    });
  }

  if (recs.length === 0) {
    recs.push({
      tipo: "acerto", titulo: "Dia sem problemas detectados",
      detalhe: "Todas as conversas tiveram resposta e nenhuma reação negativa.",
      acao: "Continuar monitorando.",
    });
  }

  return recs;
}

interface ReportData {
  totalConvs: number; novasConvs: number; totalIn: number; totalOut: number; totalFailed: number;
  intentPreco: number; intentVideo: number; intentPlantio: number; intentNutricao: number;
  funilEnroll: number; funilPedidoPreco: number; funilPagamento: number;
  semResposta: { conv: string; contato: string; msg: string; ts: string }[];
  msgsIgnoradas: { conv: string; contato: string; msg: string; ts: string }[];
  reacoesNegativas: { conv: string; contato: string; msg: string; contexto: string }[];
  perguntasSemIntent: { msg: string; count: number }[];
  conversas: ConvReport[];
  recomendacoes: Recomendacao[];
}

function renderHTML(data: string, r: ReportData): string {
  const statusColors: Record<string, string> = { converteu: "#27ae60", engajou: "#3498db", ignorou: "#95a5a6", perdeu: "#e74c3c" };
  const statusLabels: Record<string, string> = { converteu: "Converteu", engajou: "Engajou", ignorou: "Sem interação", perdeu: "Perdeu" };
  const recsIcons: Record<string, string> = { erro: "🔴", atencao: "🟡", acerto: "🟢" };

  const recsHTML = r.recomendacoes.map(rec => `
    <div class="rec rec-${rec.tipo}">
      <div class="rec-header">${recsIcons[rec.tipo]} <strong>${esc(rec.titulo)}</strong></div>
      <div class="rec-detalhe">${esc(rec.detalhe)}</div>
      <div class="rec-acao">➜ ${esc(rec.acao)}</div>
    </div>
  `).join("\n");

  const funilHTML = `
    <div class="funil">
      <div class="funil-step"><div class="funil-num">${r.funilEnroll}</div><div class="funil-label">Entraram no funil</div></div>
      <div class="funil-arrow">→</div>
      <div class="funil-step"><div class="funil-num">${r.intentPreco}</div><div class="funil-label">Pediram preço</div></div>
      <div class="funil-arrow">→</div>
      <div class="funil-step"><div class="funil-num">${r.funilPagamento}</div><div class="funil-label">Pagamento</div></div>
    </div>
  `;

  const semRespostaHTML = r.semResposta.length === 0
    ? `<p style="color:#27ae60">✅ Todas as conversas tiveram resposta do bot</p>`
    : r.semResposta.map(s => `<div class="alerta">⚠️ <strong>${esc(s.contato)}</strong> (${s.ts}) — "${esc(s.msg)}"</div>`).join("\n");

  const convsHTML = r.conversas.map(c => {
    const cor = statusColors[c.status];
    const label = statusLabels[c.status];
    const etapasStr = c.etapas.length > 0 ? c.etapas.map(e => `<span class="tag">${e}</span>`).join("") : "";
    return `
    <details class="conv">
      <summary>
        <span class="status-dot" style="background:${cor}"></span>
        <strong>${esc(c.contato)}</strong> (****${c.telefone})
        ${c.cwId ? `<span class="tag">CW #${c.cwId}</span>` : ""}
        <span class="tag">${c.msgs.length} msgs</span>
        <span class="tag" style="background:${cor}22;color:${cor}">${label}</span>
        ${etapasStr}
      </summary>
      <pre class="chat">${esc(c.resumo)}</pre>
    </details>
  `}).join("\n");

  const countByStatus = { converteu: 0, engajou: 0, ignorou: 0, perdeu: 0 };
  for (const c of r.conversas) countByStatus[c.status]++;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório ${data} — Campo Soberano</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f5f5f5; color: #333; padding: 20px; max-width: 960px; margin: 0 auto; }
  h1 { color: #2d6a1e; margin-bottom: 5px; }
  .subtitle { color: #666; margin-bottom: 20px; }
  .toolbar { margin-bottom: 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .toolbar a, .toolbar button { color: #2d6a1e; text-decoration: none; font-weight: bold; padding: 6px 14px; border: 1px solid #2d6a1e; border-radius: 6px; background: white; cursor: pointer; font-size: 14px; }
  .toolbar a:hover, .toolbar button:hover { background: #2d6a1e; color: white; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-bottom: 20px; }
  .card { background: white; border-radius: 10px; padding: 14px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .card .num { font-size: 1.8rem; font-weight: bold; color: #2d6a1e; }
  .card .label { font-size: .8rem; color: #666; }
  .card.danger .num { color: #e74c3c; }
  .section { background: white; border-radius: 10px; padding: 20px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .section h2 { color: #2d6a1e; margin-bottom: 12px; font-size: 1.05rem; }
  .alerta { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 14px; margin-bottom: 8px; border-radius: 4px; font-size: .88rem; }
  .conv { margin-bottom: 6px; }
  .conv summary { cursor: pointer; padding: 10px; background: #f9f9f9; border-radius: 6px; font-size: .9rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .conv summary:hover { background: #eef5ee; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
  .tag { background: #e8f5e9; color: #2d6a1e; padding: 2px 8px; border-radius: 12px; font-size: .7rem; }
  .chat { background: #1a1a2e; color: #eee; padding: 14px; border-radius: 6px; font-size: .78rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; margin-top: 8px; }
  .intents { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
  .intent { background: #f0f7f0; padding: 10px; border-radius: 8px; text-align: center; }
  .intent .num { font-size: 1.3rem; font-weight: bold; color: #2d6a1e; }
  .intent .label { font-size: .78rem; color: #555; }
  .funil { display: flex; align-items: center; gap: 8px; justify-content: center; margin: 16px 0; flex-wrap: wrap; }
  .funil-step { background: #f0f7f0; padding: 14px 20px; border-radius: 10px; text-align: center; min-width: 100px; }
  .funil-num { font-size: 1.6rem; font-weight: bold; color: #2d6a1e; }
  .funil-label { font-size: .78rem; color: #555; }
  .funil-arrow { font-size: 1.5rem; color: #aaa; }
  .rec { padding: 14px; margin-bottom: 10px; border-radius: 8px; border-left: 4px solid; }
  .rec-erro { background: #fef2f2; border-color: #e74c3c; }
  .rec-atencao { background: #fffbeb; border-color: #f59e0b; }
  .rec-acerto { background: #f0fdf4; border-color: #22c55e; }
  .rec-header { font-size: .95rem; margin-bottom: 6px; }
  .rec-detalhe { font-size: .85rem; color: #555; margin-bottom: 6px; }
  .rec-acao { font-size: .85rem; color: #2d6a1e; font-weight: 500; }
  .status-bar { display: flex; gap: 14px; margin-bottom: 16px; flex-wrap: wrap; }
  .status-bar div { display: flex; align-items: center; gap: 5px; font-size: .85rem; }
  #export-area { display: none; }
</style>
</head>
<body>
<h1>📊 Relatório do Dia</h1>
<p class="subtitle">${data} — Campo Soberano / Mega Sorgo</p>

<div class="toolbar">
  <a href="?data=${prevDay(data)}">← Anterior</a>
  <a href="?data=${nextDay(data)}">Próximo →</a>
  <a href="?">Hoje</a>
  <button onclick="exportar()">📋 Copiar relatório</button>
</div>

<div class="cards">
  <div class="card"><div class="num">${r.novasConvs}</div><div class="label">Conversas novas</div></div>
  <div class="card"><div class="num">${r.totalConvs}</div><div class="label">Conversas ativas</div></div>
  <div class="card"><div class="num">${r.totalIn}</div><div class="label">Recebidas</div></div>
  <div class="card"><div class="num">${r.totalOut}</div><div class="label">Enviadas</div></div>
  <div class="card ${r.totalFailed > 0 ? "danger" : ""}"><div class="num">${r.totalFailed}</div><div class="label">Falhas</div></div>
  <div class="card ${r.semResposta.length > 0 ? "danger" : ""}"><div class="num">${r.semResposta.length}</div><div class="label">Sem resposta</div></div>
</div>

<div class="status-bar">
  <div><span class="status-dot" style="background:#27ae60"></span> Converteu: ${countByStatus.converteu}</div>
  <div><span class="status-dot" style="background:#3498db"></span> Engajou: ${countByStatus.engajou}</div>
  <div><span class="status-dot" style="background:#95a5a6"></span> Sem interação: ${countByStatus.ignorou}</div>
  <div><span class="status-dot" style="background:#e74c3c"></span> Perdeu: ${countByStatus.perdeu}</div>
</div>

<div class="section">
  <h2>🔄 Funil de Conversão</h2>
  ${funilHTML}
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
  <h2>📋 Recomendações</h2>
  ${recsHTML}
</div>

<div class="section">
  <h2>⚠️ Sem Resposta do Bot</h2>
  ${semRespostaHTML}
</div>

<div class="section">
  <h2>💬 Conversas (${r.conversas.length})</h2>
  ${convsHTML}
</div>

<textarea id="export-area"></textarea>

<p style="text-align:center;color:#999;margin-top:20px;font-size:.8rem">Gerado em ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC</p>

<script>
function exportar() {
  const recs = document.querySelectorAll('.rec');
  let txt = "RELATÓRIO ${data} — CAMPO SOBERANO\\n";
  txt += "==========================================\\n\\n";
  txt += "NÚMEROS:\\n";
  document.querySelectorAll('.card').forEach(c => {
    txt += "  " + c.querySelector('.num').textContent + " " + c.querySelector('.label').textContent + "\\n";
  });
  txt += "\\nFUNIL: Entraram: ${r.funilEnroll} → Preço: ${r.intentPreco} → Pagamento: ${r.funilPagamento}\\n";
  txt += "\\nSTATUS: Converteu: ${countByStatus.converteu} | Engajou: ${countByStatus.engajou} | Sem interação: ${countByStatus.ignorou} | Perdeu: ${countByStatus.perdeu}\\n";
  txt += "\\nRECOMENDAÇÕES:\\n";
  recs.forEach(r => {
    txt += "  " + r.querySelector('.rec-header').textContent + "\\n";
    txt += "    " + r.querySelector('.rec-detalhe').textContent + "\\n";
    txt += "    " + r.querySelector('.rec-acao').textContent + "\\n\\n";
  });
  txt += "\\nCONVERSAS:\\n";
  document.querySelectorAll('.conv').forEach(c => {
    txt += "\\n--- " + c.querySelector('summary').textContent.trim() + " ---\\n";
    txt += c.querySelector('.chat').textContent + "\\n";
  });
  navigator.clipboard.writeText(txt).then(() => alert('Relatório copiado!')).catch(() => {
    const area = document.getElementById('export-area');
    area.style.display = 'block';
    area.value = txt;
    area.select();
    document.execCommand('copy');
    area.style.display = 'none';
    alert('Relatório copiado!');
  });
}
</script>
</body>
</html>`;
}

function esc(s: string): string {
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
