"use client";
// FlowSimulator — simula a conversa do fluxo SEM disparar nada. Caminha pelo grafo do mesmo jeito
// que o motor (shared/flow.ts: stepsUntilWait + resolveNext), renderiza as mensagens numa prévia
// de WhatsApp e deixa o usuário clicar botões/linhas (ou digitar) para percorrer os ramos.
// Interpola {{variáveis}} com o contato de teste. 100% client-side: nenhuma chamada ao bridge.
import { useState, useMemo, useCallback, useEffect } from "react";

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
function interpolate(text, vars) {
  if (!text || !String(text).includes("{{")) return text ?? "";
  return String(text).replace(VAR_RE, (_m, k) => vars?.[k.toLowerCase()] ?? "");
}

const ESPERA = new Set(["buttons", "list", "ai", "input"]);
const byId = (steps, id) => steps.find((s) => s.id === id);

function avaliarCond(step, vars) {
  const c = step.cond;
  if (!c?.field) return "nao";
  const norm = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const v = (vars?.[c.field.toLowerCase()] ?? "").trim();
  const alvo = c.value ?? "";
  let ok = false;
  if (c.op === "existe") ok = v !== "";
  else if (c.op === "vazio") ok = v === "";
  else if (c.op === "igual") ok = norm(v) === norm(alvo);
  else if (c.op === "diferente") ok = norm(v) !== norm(alvo);
  else if (c.op === "contem") ok = alvo !== "" && norm(v).includes(norm(alvo));
  return ok ? "sim" : "nao";
}

function alvosDeRamificacao(steps) {
  const alvos = new Set();
  for (const s of steps) {
    for (const d of Object.values(s.branches ?? {})) alvos.add(d);
    if (s.fallbackNext) alvos.add(s.fallbackNext);
    if (s.onTimeout) alvos.add(s.onTimeout);
  }
  return alvos;
}
function proximoNaOrdem(steps, id) {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0 || i + 1 >= steps.length) return null;
  const prox = steps[i + 1];
  return alvosDeRamificacao(steps).has(prox.id) ? null : prox.id;
}
function resolveNext(step, replyId) {
  if (replyId && step.branches?.[replyId]) return step.branches[replyId];
  if (replyId === null && step.fallbackNext) return step.fallbackNext;
  return step.fallbackNext ?? step.next ?? null;
}

/** Envia a partir de fromId até parar numa pergunta, pausa ou fim. Espelha stepsUntilWait. */
function walk(steps, fromId, vars) {
  const enviar = [];
  const vistos = new Set();
  let atual = byId(steps, fromId);
  while (atual) {
    if (vistos.has(atual.id)) return { enviar, pararEm: null, fim: true };
    vistos.add(atual.id);
    if (atual.kind === "end") return { enviar, pararEm: atual, fim: true };
    if (atual.kind === "wait") return { enviar, pararEm: atual, fim: false };
    if (atual.kind === "condition") {
      const prox = atual.branches?.[avaliarCond(atual, vars)];
      atual = prox ? byId(steps, prox) : undefined;
      continue;
    }
    if (atual.kind === "transfer") { enviar.push(atual); return { enviar, pararEm: atual, fim: true }; }
    if (atual.kind === "goto") { enviar.push(atual); return { enviar, pararEm: atual, fim: true }; }
    enviar.push(atual);
    if (ESPERA.has(atual.kind)) return { enviar, pararEm: atual, fim: false };
    const prox = atual.next ?? proximoNaOrdem(steps, atual.id);
    atual = prox ? byId(steps, prox) : undefined;
  }
  return { enviar, pararEm: null, fim: true };
}

function Bubble({ step, vars }) {
  const cor = "var(--surface-2)";
  if (step.kind === "wait") {
    return <div style={{ alignSelf: "center", fontSize: 11, color: "var(--text-faint)" }}>⏸ pausa de {step.minutes ?? 0} min</div>;
  }
  if (step.kind === "end") {
    return <div style={{ alignSelf: "center", fontSize: 11, color: "var(--text-faint)" }}>■ fim{step.outcome ? ` (${step.outcome})` : ""}</div>;
  }
  if (step.kind === "action") {
    const a = step.contatoAcao ?? {};
    const partes = [];
    if (a.addLabels?.length) partes.push(`+${a.addLabels.join(", ")}`);
    if (a.removeLabels?.length) partes.push(`−${a.removeLabels.join(", ")}`);
    if (a.setNome) partes.push(`nome=${a.setNome}`);
    return <div style={{ alignSelf: "center", fontSize: 11, color: "var(--text-faint)" }}>🏷 ação: {partes.join(" · ") || "(vazia)"}</div>;
  }
  if (step.kind === "api") {
    return <div style={{ alignSelf: "center", fontSize: 11, color: "var(--text-faint)" }}>🔌 API {step.api?.method ?? "POST"} {step.api?.url || "(sem url)"}</div>;
  }
  if (step.kind === "goto") {
    return <div style={{ alignSelf: "center", fontSize: 11, color: "var(--text-faint)" }}>➜ vai pro fluxo {step.gotoFlowId || "(?)"}</div>;
  }
  return (
    <div style={{ alignSelf: "flex-start", maxWidth: "80%", background: cor, border: "1px solid var(--border-soft)", borderRadius: "12px 12px 12px 4px", padding: "8px 11px", fontSize: 13, color: "var(--text)" }}>
      {step.kind === "media" && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>🖼 {step.media?.type ?? "mídia"}{step.media?.url ? "" : " (sem url)"}</div>
      )}
      {step.kind === "buttons" && step.imageUrl && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 4 }}>🖼 imagem</div>
      )}
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.4 }}>{interpolate(step.text, vars) || <span style={{ color: "var(--text-faint)" }}>(sem texto)</span>}</div>
      {step.kind === "cta" && (
        <div style={{ marginTop: 6, padding: "6px 10px", borderRadius: 8, background: "var(--bg-deep)", border: "1px solid var(--border-soft)", textAlign: "center", color: "var(--mint)", fontSize: 12 }}>
          🔗 {step.ctaText || "Abrir"}
        </div>
      )}
      {step.kind === "transfer" && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--amber)" }}>→ transferido para atendente (bot silenciado)</div>
      )}
    </div>
  );
}

export default function FlowSimulator({ value, vars = {} }) {
  const steps = useMemo(() => value?.steps ?? [], [value]);
  const inicioId = useMemo(
    () => (value?.startId && steps.some((s) => s.id === value.startId)) ? value.startId : steps[0]?.id,
    [value, steps],
  );

  const [historico, setHistorico] = useState([]); // [{tipo:'bot'|'user', step?|texto}]
  const [esperando, setEsperando] = useState(null); // step aguardando resposta
  const [fim, setFim] = useState(false);
  const [textoLivre, setTextoLivre] = useState("");
  const [capturados, setCapturados] = useState({}); // respostas de nós "input" nesta simulação
  // Vars do contato + o que o lead respondeu nas perguntas abertas (pra {{var}} aparecer preenchida).
  const varsFull = useMemo(() => ({ ...vars, ...capturados }), [vars, capturados]);

  const avancar = useCallback((fromId, novos = [], varsOverride) => {
    const v = varsOverride ?? varsFull;
    const { enviar, pararEm, fim: acabou } = walk(steps, fromId, v);
    setHistorico((h) => [...h, ...novos, ...enviar.map((s) => ({ tipo: "bot", step: s }))]);
    if (pararEm?.kind === "wait") {
      // segue depois da pausa (na simulação não espera de verdade)
      const prox = pararEm.next ?? proximoNaOrdem(steps, pararEm.id);
      if (prox) { avancar(prox); return; }
    }
    if (acabou || !pararEm || pararEm.kind === "end") { setEsperando(null); setFim(true); return; }
    if (ESPERA.has(pararEm.kind)) { setEsperando(pararEm); setFim(false); }
  }, [steps, varsFull]);

  const reiniciar = useCallback(() => {
    setHistorico([]); setEsperando(null); setFim(false); setTextoLivre(""); setCapturados({});
    if (inicioId) avancar(inicioId, [], vars);
  }, [inicioId, avancar, vars]);

  useEffect(() => { reiniciar(); /* reinicia quando o fluxo muda */ }, [inicioId, steps.length]); // eslint-disable-line

  const responder = (replyId, rotulo) => {
    // Pergunta aberta: guarda a resposta na variável pra os próximos {{var}} aparecerem preenchidos.
    let v = varsFull;
    if (esperando?.kind === "input" && esperando.input?.var) {
      const val = esperando.input.tipo === "numero" ? String(rotulo).replace(/\D/g, "") : rotulo;
      const next = { ...capturados, [esperando.input.var]: val };
      setCapturados(next);
      v = { ...vars, ...next };
    }
    const destino = resolveNext(esperando, replyId);
    const userMsg = { tipo: "user", texto: rotulo };
    setEsperando(null);
    if (!destino) { setHistorico((h) => [...h, userMsg]); setFim(true); return; }
    avancar(destino, [userMsg], v);
  };

  const enviarLivre = () => {
    if (!textoLivre.trim() || !esperando) return;
    const t = textoLivre.trim();
    setTextoLivre("");
    responder(null, t);
  };

  const opcoes = esperando
    ? (esperando.kind === "buttons"
        ? (esperando.buttons ?? []).map((b) => ({ id: b.id, rotulo: interpolate(b.title, varsFull) }))
        : esperando.kind === "ai"
        ? [...(esperando.ai?.opcoes ?? []).map((o) => ({ id: o.id, rotulo: o.titulo || o.id })), { id: "fallback", rotulo: "↪ baixa confiança" }]
        : esperando.kind === "input"
        ? [] // pergunta aberta: sem botões, a resposta é o texto digitado
        : (esperando.sections ?? []).flatMap((sec) => (sec.rows ?? []).map((r) => ({ id: r.id, rotulo: interpolate(r.title, varsFull) }))))
    : [];

  if (!steps.length) return <div style={{ fontSize: 13, color: "var(--text-faint)" }}>Monte um fluxo para simular.</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Prévia da conversa — nada é enviado.</div>
        <button className="btn-ghost mini" onClick={reiniciar}>↻ Reiniciar</button>
      </div>
      <div style={{ maxWidth: 420, margin: "0 auto", background: "var(--bg-deep)", border: "1px solid var(--border)", borderRadius: 14, padding: 14, minHeight: 240, display: "flex", flexDirection: "column", gap: 8 }}>
        {historico.map((m, i) => m.tipo === "user"
          ? <div key={i} style={{ alignSelf: "flex-end", maxWidth: "80%", background: "var(--mint)", color: "#06241a", borderRadius: "12px 12px 4px 12px", padding: "7px 11px", fontSize: 13 }}>{m.texto}</div>
          : <Bubble key={i} step={m.step} vars={varsFull} />)}

        {esperando && opcoes.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            {opcoes.map((o) => (
              <button key={o.id} className="btn-ghost" style={{ fontSize: 12, padding: "6px 10px", borderRadius: 16 }} onClick={() => responder(o.id, o.rotulo)}>
                {o.rotulo}
              </button>
            ))}
          </div>
        )}
        {fim && <div style={{ alignSelf: "center", fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>— conversa encerrada —</div>}
      </div>

      {esperando && (
        <div style={{ maxWidth: 420, margin: "8px auto 0", display: "flex", gap: 6 }}>
          <input value={textoLivre} onChange={(e) => setTextoLivre(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enviarLivre()}
            placeholder={esperando.kind === "input" ? "digite a resposta…" : "…ou digita (segue por 'digitou texto')"} style={{ flex: 1, fontSize: 13, padding: "7px 10px", borderRadius: 10 }} />
          <button className="btn-mint" style={{ padding: "7px 14px", borderRadius: 10 }} onClick={enviarLivre}>Enviar</button>
        </div>
      )}
    </div>
  );
}
