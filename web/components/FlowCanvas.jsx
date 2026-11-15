"use client";
// FlowCanvas — editor visual (React Flow) do mesmo modelo de shared/flow.ts.
// Controlado: recebe `value` (Flow), desenha o grafo, chama `onChange(novoFlow)` a cada edição.
// Fonte de verdade = { steps, startId }. Posição (x/y) não existe no modelo → layout automático +
// arrasto em localStorage. Só prévia aqui; quem envia/personaliza é o bridge.
//
// Redesign 2026-10-12b: paleta vira BARRA LATERAL rolável (não flutua/tampa a tela). Operações
// de nó estilo n8n: duplicar, copiar, recortar, colar (Ctrl+C/X/V/D) + nome e cor por bloco.
// `nome` e `cor` são campos extras no step — o motor ignora; só a UI usa.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  Handle, Position, useNodesState, useEdgesState,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// ── Tipos de bloco: cor, rótulo, ícone (path SVG 24x24) ──────────────────────
const KINDS = [
  { k: "text",    label: "Texto",       cor: "var(--blue)",       grupo: "Mensagem",   icon: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.9-.9L3 20l1.3-4.1A8.4 8.4 0 1 1 21 11.5Z" },
  { k: "media",   label: "Mídia",       cor: "var(--amber)",      grupo: "Mensagem",   icon: "M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6" },
  { k: "buttons", label: "Botões",      cor: "var(--mint)",       grupo: "Interativo", icon: "M4 6h16M4 12h16M4 18h10" },
  { k: "list",    label: "Lista",       cor: "var(--mint)",       grupo: "Interativo", icon: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" },
  { k: "cta",     label: "Botão link",  cor: "var(--mint)",       grupo: "Interativo", icon: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" },
  { k: "input",   label: "Pergunta aberta", cor: "#0ea5e9",       grupo: "Interativo", icon: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" },
  { k: "condition", label: "Condição",  cor: "var(--blue)",       grupo: "Lógica",     icon: "M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a9 9 0 0 0 9-9" },
  { k: "transfer", label: "Atendente",  cor: "var(--amber)",      grupo: "Lógica",     icon: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M16 11h6M19 8l3 3-3 3" },
  { k: "ai",      label: "Agente IA",   cor: "var(--blue)",       grupo: "Lógica",     icon: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9zM19 15l.7 2.1L22 18l-2.3.7L19 21l-.7-2.3L16 18z" },
  { k: "action",  label: "Ação contato",cor: "var(--mint)",       grupo: "Lógica",     icon: "M20.6 13.4 12 22l-8-8 8.6-8.6a2 2 0 0 1 1.4-.6H20a2 2 0 0 1 2 2v6a2 2 0 0 1-.6 1.4ZM17 7h.01" },
  { k: "api",     label: "Chamada API", cor: "#8b5cf6",           grupo: "Lógica",     icon: "M4 7h16M4 7l3-3M4 7l3 3M20 17H4M20 17l-3-3M20 17l-3 3" },
  { k: "goto",    label: "Ir p/ fluxo", cor: "var(--text-faint)", grupo: "Controle",   icon: "M4 12h14M13 6l6 6-6 6" },
  { k: "wait",    label: "Pausa",       cor: "var(--text-faint)", grupo: "Controle",   icon: "M12 7v5l3 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z" },
  { k: "end",     label: "Fim",         cor: "var(--green)",      grupo: "Controle",   icon: "M5 3v18M5 4h11l-2 4 2 4H5" },
];
const kindMeta = (k) => KINDS.find((x) => x.k === k) ?? KINDS[0];
const ESPERA = new Set(["buttons", "list", "input"]);
// Paleta de cores pra pintar um bloco (n8n-style). undefined = cor padrão do tipo.
const CORES = ["var(--blue)", "var(--mint)", "var(--amber)", "var(--green)", "var(--red)", "#8b5cf6", "#ec4899"];

const nomeDe = (s) => (s.nome?.trim() ? s.nome.trim() : kindMeta(s.kind).label);
const corDe = (s) => s.cor || kindMeta(s.kind).cor;

function Ico({ d, size = 14, color = "currentColor" }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>;
}

function novoId() { return "s_" + Math.random().toString(36).slice(2, 8); }

// ── Variáveis {{...}} (prévia; quem aplica de verdade é o bridge) ────────────
const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;
function interpolate(text, vars) {
  if (!text || !String(text).includes("{{")) return text ?? "";
  return String(text).replace(VAR_RE, (_m, k) => vars?.[k.toLowerCase()] ?? "");
}
const VARS_DISPONIVEIS = ["nome", "primeiro_nome", "telefone"];

function resumo(s) {
  if (s.kind === "media") return `${s.media?.type ?? "mídia"} — ${s.media?.url ? "ok" : "(sem url)"}`;
  if (s.kind === "cta") return `${s.text ?? ""}`;
  if (s.kind === "condition") return `se ${s.cond?.field ?? "?"} ${s.cond?.op ?? ""} ${s.cond?.value ?? ""}`.trim();
  if (s.kind === "transfer") return s.text || "passa pro atendente";
  if (s.kind === "ai") return s.text || "pergunta + IA classifica";
  if (s.kind === "action") {
    const a = s.contatoAcao ?? {};
    const partes = [];
    if (a.addLabels?.length) partes.push(`+${a.addLabels.join(", ")}`);
    if (a.removeLabels?.length) partes.push(`−${a.removeLabels.join(", ")}`);
    if (a.setNome) partes.push(`nome=${a.setNome}`);
    return partes.join(" · ") || "(sem ação)";
  }
  if (s.kind === "input") return `${s.text ?? "pergunta"} → guarda {{${s.input?.var || "?"}}}`;
  if (s.kind === "api") return `${s.api?.method ?? "POST"} ${s.api?.url || "(sem url)"}`;
  if (s.kind === "goto") return `vai pro fluxo ${s.gotoFlowId || "(?)"}`;
  if (s.kind === "wait") return `pausa de ${s.minutes ?? 0} min`;
  if (s.kind === "end") return s.outcome ? `encerra como ${s.outcome}` : "encerra o fluxo";
  return s.text ?? "";
}

/** Saídas declaradas → handles de origem + arestas. Espelha flow.ts. */
function saidasDe(s) {
  const out = [];
  if (s.kind === "buttons") for (const b of s.buttons ?? []) out.push({ handle: `btn:${b.id}`, rotulo: b.title || b.id, destino: s.branches?.[b.id] ?? null });
  if (s.kind === "list") for (const sec of s.sections ?? []) for (const r of sec.rows ?? []) out.push({ handle: `row:${r.id}`, rotulo: r.title || r.id, destino: s.branches?.[r.id] ?? null });
  if (s.kind === "condition") {
    out.push({ handle: "cond:sim", rotulo: "sim", destino: s.branches?.sim ?? null });
    out.push({ handle: "cond:nao", rotulo: "não", destino: s.branches?.nao ?? null });
  } else if (s.kind === "ai") {
    for (const o of s.ai?.opcoes ?? []) out.push({ handle: `ai:${o.id}`, rotulo: o.titulo || o.id, destino: s.branches?.[o.id] ?? null });
    out.push({ handle: "ai:fallback", rotulo: "baixa confiança", destino: s.branches?.fallback ?? null });
  } else if (s.kind === "input") {
    // Pergunta aberta: guarda a resposta e SEGUE (saída única); não ramifica por conteúdo.
    out.push({ handle: "seq", rotulo: "resposta → segue", destino: s.next ?? null });
    out.push({ handle: "timeout", rotulo: `sem resposta${s.timeoutMin ? ` (${s.timeoutMin}min)` : ""}`, destino: s.onTimeout ?? null });
  } else if (ESPERA.has(s.kind)) {
    out.push({ handle: "fallback", rotulo: "digitou texto", destino: s.fallbackNext ?? null });
    out.push({ handle: "timeout", rotulo: `sem resposta${s.timeoutMin ? ` (${s.timeoutMin}min)` : ""}`, destino: s.onTimeout ?? null });
  } else if (s.kind !== "end" && s.kind !== "transfer" && s.kind !== "goto") {
    // goto é terminal (salta pra outro fluxo); end/transfer encerram. O resto (inclui
    // action/api) tem uma saída única "segue".
    out.push({ handle: "seq", rotulo: "segue", destino: s.next ?? null });
  }
  return out;
}

function ligarSaida(step, handle, destino) {
  const s = JSON.parse(JSON.stringify(step));
  if (handle === "seq") { if (destino) s.next = destino; else delete s.next; }
  else if (handle === "fallback") { if (destino) s.fallbackNext = destino; else delete s.fallbackNext; }
  else if (handle === "timeout") { if (destino) s.onTimeout = destino; else delete s.onTimeout; }
  else if (handle.startsWith("btn:") || handle.startsWith("row:")) {
    const key = handle.slice(4);
    s.branches = { ...(s.branches ?? {}) };
    if (destino) s.branches[key] = destino; else delete s.branches[key];
    if (!Object.keys(s.branches).length) delete s.branches;
  }
  else if (handle === "cond:sim" || handle === "cond:nao") {
    const key = handle.slice(5); // sim | nao
    s.branches = { ...(s.branches ?? {}) };
    if (destino) s.branches[key] = destino; else delete s.branches[key];
    if (!Object.keys(s.branches).length) delete s.branches;
  }
  else if (handle.startsWith("ai:")) {
    const key = handle.slice(3); // id da opção ou "fallback"
    s.branches = { ...(s.branches ?? {}) };
    if (destino) s.branches[key] = destino; else delete s.branches[key];
    if (!Object.keys(s.branches).length) delete s.branches;
  }
  return s;
}

/** Clona um step como cópia SOLTA: novo id, sem as ligações de saída (evita arestas duplicadas). */
function clonarSolto(step) {
  const s = JSON.parse(JSON.stringify(step));
  s.id = novoId();
  delete s.next; delete s.branches; delete s.fallbackNext; delete s.onTimeout;
  return s;
}

function autoLayout(steps, startId) {
  const COL = 300, ROW = 150;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const nivel = new Map();
  const raiz = startId && byId.has(startId) ? startId : steps[0]?.id;
  const fila = raiz ? [[raiz, 0]] : [];
  const visto = new Set();
  while (fila.length) {
    const [id, n] = fila.shift();
    if (visto.has(id) || !byId.has(id)) continue;
    visto.add(id); nivel.set(id, Math.max(nivel.get(id) ?? 0, n));
    for (const o of saidasDe(byId.get(id))) if (o.destino && byId.has(o.destino)) fila.push([o.destino, n + 1]);
  }
  for (const s of steps) if (!nivel.has(s.id)) nivel.set(s.id, Math.max(...[...nivel.values(), 0]) + 1);
  const porNivel = new Map(); const pos = {};
  for (const s of steps) {
    const n = nivel.get(s.id) ?? 0; const i = porNivel.get(n) ?? 0;
    porNivel.set(n, i + 1); pos[s.id] = { x: n * COL, y: i * ROW };
  }
  return pos;
}

const LS_KEY = "flow-canvas-pos";
const lerPosicoes = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; } };
const gravarPosicoes = (p) => { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
// Clipboard de nó (localStorage → copia/cola entre fluxos).
const CLIP_KEY = "flow-clip";
const lerClip = () => { try { return JSON.parse(localStorage.getItem(CLIP_KEY) || "null"); } catch { return null; } };
const gravarClip = (s) => { try { localStorage.setItem(CLIP_KEY, JSON.stringify(s)); } catch { /* ignore */ } };

// Kinds que mandam mensagem → ganham balão WYSIWYG no nó (parecido com o WhatsApp).
const MSG_KINDS = new Set(["text", "input", "ai", "transfer", "buttons", "list", "cta", "media"]);

/** Corpo do nó: balão da mensagem (como o lead vê) + pills de botão. Lógica = linha compacta. */
function StepBody({ s, vars, preview }) {
  if (!MSG_KINDS.has(s.kind)) {
    return (
      <div style={{ marginTop: 7, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {preview || <span style={{ color: "var(--text-faint)" }}>(vazio)</span>}
      </div>
    );
  }
  const texto = interpolate(s.text, vars);
  const bolha = {
    marginTop: 8, background: "var(--surface-2)", border: "1px solid var(--border-soft)",
    borderRadius: "11px 11px 11px 4px", padding: "7px 9px", fontSize: 11.5, color: "var(--text)", lineHeight: 1.4,
  };
  const pill = {
    fontSize: 10.5, padding: "3px 8px", borderRadius: 12, border: "1px solid var(--border)",
    color: "var(--text-dim)", background: "var(--surface)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150,
  };
  const linhas = (s.sections ?? []).flatMap((sec) => sec.rows ?? []);
  return (
    <div>
      <div style={bolha}>
        {s.kind === "media" && <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 3 }}>🖼 {s.media?.type ?? "mídia"}{s.media?.url ? "" : " (sem url)"}</div>}
        {s.kind === "buttons" && s.imageUrl && <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 3 }}>🖼 imagem</div>}
        <div style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", whiteSpace: "pre-wrap" }}>
          {texto || <span style={{ color: "var(--text-faint)" }}>{s.kind === "input" ? "(sem pergunta)" : "(sem texto)"}</span>}
        </div>
        {s.kind === "input" && s.input?.var && <div style={{ marginTop: 5, fontSize: 10, color: "#0ea5e9" }}>✎ guarda em <code>{`{{${s.input.var}}}`}</code></div>}
        {s.kind === "cta" && <div style={{ marginTop: 6, padding: "4px 8px", borderRadius: 7, background: "var(--surface)", border: "1px solid var(--border-soft)", textAlign: "center", color: "var(--mint)", fontSize: 11 }}>🔗 {s.ctaText || "Abrir"}</div>}
        {s.kind === "transfer" && <div style={{ marginTop: 5, fontSize: 10, color: "var(--amber)" }}>→ atendente{s.transferTeamId ? ` · time ${s.transferTeamId}` : ""}</div>}
      </div>
      {s.kind === "buttons" && (s.buttons?.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {s.buttons.map((b) => <span key={b.id} style={pill}>{interpolate(b.title, vars) || b.id}</span>)}
        </div>
      )}
      {s.kind === "list" && linhas.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
          {linhas.slice(0, 3).map((r) => <span key={r.id} style={pill}>{interpolate(r.title, vars) || r.id}</span>)}
          {linhas.length > 3 && <span style={{ ...pill, color: "var(--text-faint)" }}>+{linhas.length - 3}</span>}
        </div>
      )}
    </div>
  );
}

// ── Nó ───────────────────────────────────────────────────────────────────────
function StepNode({ data }) {
  const s = data.step;
  const meta = kindMeta(s.kind);
  const cor = corDe(s);
  const titulo = nomeDe(s);
  const saidas = saidasDe(s);
  const preview = interpolate(resumo(s), data.vars);
  return (
    <div style={{
      width: 224, borderRadius: 14, background: "var(--surface)",
      border: `1px solid ${data.selecionado ? cor : "var(--border-soft)"}`,
      boxShadow: data.selecionado ? `0 0 0 2px ${cor}33, 0 6px 20px rgba(0,0,0,.18)` : "0 2px 10px rgba(0,0,0,.10)",
      fontSize: 12, transition: "box-shadow .15s, border-color .15s",
    }}>
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8, background: "var(--text-faint)", border: "none" }} />
      <div style={{ height: 3, borderTopLeftRadius: 14, borderTopRightRadius: 14, background: cor }} />
      <div style={{ padding: "9px 10px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${cor} 16%, transparent)`, flex: "0 0 auto" }}>
            <Ico d={meta.icon} size={13} color={cor} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, color: "var(--text)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titulo}</div>
            <div style={{ fontSize: 9.5, color: cor, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".04em" }}>{meta.label}</div>
          </div>
          {s.delaySeg ? <span title={`espera ${s.delaySeg}s antes de enviar`} style={{ fontSize: 9.5, color: "var(--text-faint)", background: "var(--surface-2)", borderRadius: 6, padding: "1px 5px", flex: "0 0 auto" }}>⏱{s.delaySeg}s</span> : null}
          {data.isStart && <span title="início do fluxo" style={{ color: "var(--green)", fontSize: 12, flex: "0 0 auto" }}>▶</span>}
        </div>
        <StepBody s={s} vars={data.vars} preview={preview} />
      </div>
      {saidas.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-soft)" }}>
          {saidas.map((o, i) => (
            <div key={o.handle} style={{
              position: "relative", padding: "5px 16px 5px 11px",
              borderTop: i ? "1px solid var(--border-soft)" : "none",
              color: o.destino ? "var(--text-dim)" : "var(--text-faint)", fontSize: 11,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: 5, background: o.destino ? "var(--mint)" : "var(--border)", flex: "0 0 auto" }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.rotulo}</span>
              <Handle type="source" id={o.handle} position={Position.Right}
                style={{ width: 8, height: 8, background: o.destino ? "var(--mint)" : "var(--text-faint)", border: "none", top: "50%" }} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const nodeTypes = { step: StepNode };

// ── Canvas ─────────────────────────────────────────────────────────────────
function Canvas({ value, onChange, problemas = [] }) {
  const steps = useMemo(() => value?.steps ?? [], [value]);
  const startId = value?.startId;
  const [selId, setSelId] = useState(null);
  const [testNome, setTestNome] = useState("Maria Silva");
  const [temClip, setTemClip] = useState(false);
  const vars = useMemo(() => ({ nome: testNome.trim(), primeiro_nome: testNome.trim().split(/\s+/)[0] ?? "", telefone: "5511999999999" }), [testNome]);
  const inicioId = useMemo(() => (startId && steps.some((s) => s.id === startId)) ? startId : steps[0]?.id, [startId, steps]);

  const posRef = useRef(null);
  if (posRef.current === null) posRef.current = (typeof window !== "undefined" ? lerPosicoes() : {});
  useEffect(() => { setTemClip(!!lerClip()); }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    const salvas = posRef.current || {};
    const faltam = steps.some((s) => !salvas[s.id]);
    const auto = faltam ? autoLayout(steps, startId) : {};
    const ns = steps.map((s) => ({
      id: s.id, type: "step",
      position: salvas[s.id] ?? auto[s.id] ?? { x: 0, y: 0 },
      data: { step: s, selecionado: s.id === selId, vars, isStart: s.id === inicioId },
    }));
    const es = [];
    for (const s of steps) for (const o of saidasDe(s)) {
      if (!o.destino) continue;
      es.push({
        id: `${s.id}__${o.handle}`, source: s.id, sourceHandle: o.handle, target: o.destino,
        label: o.rotulo, animated: ESPERA.has(s.kind),
        style: { stroke: "var(--border)", strokeWidth: 1.5 },
        labelStyle: { fontSize: 10, fill: "var(--text-faint)" },
        labelBgStyle: { fill: "var(--surface)", fillOpacity: .9 },
      });
    }
    setNodes(ns); setEdges(es);
  }, [steps, startId, selId, vars, inicioId, setNodes, setEdges]);

  const mutarStep = useCallback((id, fn) => onChange({ ...value, steps: steps.map((s) => (s.id === id ? fn(s) : s)) }), [steps, value, onChange]);
  const setStart = useCallback((id) => onChange({ ...value, startId: id }), [value, onChange]);
  const onConnect = useCallback((p) => { if (p.source && p.target) mutarStep(p.source, (s) => ligarSaida(s, p.sourceHandle || "seq", p.target)); }, [mutarStep]);
  const onEdgesDelete = useCallback((apagadas) => { for (const e of apagadas) mutarStep(e.source, (s) => ligarSaida(s, e.sourceHandle || "seq", null)); }, [mutarStep]);
  const onNodeDragStop = useCallback((_e, node) => { posRef.current = { ...posRef.current, [node.id]: node.position }; gravarPosicoes(posRef.current); }, []);

  const colocarPos = useCallback((id, p) => { posRef.current = { ...posRef.current, [id]: p }; gravarPosicoes(posRef.current); }, []);

  const addStep = useCallback((kind) => {
    const id = novoId();
    const base = { id, kind };
    if (kind === "text") base.text = "";
    if (kind === "buttons") base.buttons = [{ id: "b1", title: "Opção 1" }];
    if (kind === "list") base.sections = [{ title: "Opções", rows: [{ id: "r1", title: "Item 1" }] }];
    if (kind === "media") base.media = { type: "image", url: "" };
    if (kind === "cta") { base.text = ""; base.ctaText = "Abrir"; base.ctaUrl = ""; }
    if (kind === "input") { base.text = "Qual o seu nome completo?"; base.input = { var: "nome_completo", tipo: "texto" }; }
    if (kind === "condition") base.cond = { field: "nome", op: "existe" };
    if (kind === "transfer") { base.text = "Um atendente vai continuar daqui 👋"; base.labels = ["bot-off"]; }
    if (kind === "ai") { base.text = "Como posso te ajudar?"; base.ai = { instrucao: "Classifique a intenção da mensagem do cliente.", opcoes: [{ id: "comprar", titulo: "Comprar", descricao: "Quer comprar, fechar, fazer o pedido" }, { id: "info", titulo: "Informação", descricao: "Dúvida sobre o produto/serviço, preço" }], minConfianca: 0.6 }; }
    if (kind === "action") base.contatoAcao = { addLabels: [], removeLabels: [], setNome: "" };
    if (kind === "api") base.api = { method: "POST", url: "", headers: {}, bodyTemplate: "" };
    if (kind === "goto") base.gotoFlowId = "";
    if (kind === "wait") base.minutes = 1;
    onChange({ ...value, steps: [...steps, base] });
    setSelId(id);
  }, [steps, value, onChange]);

  const delStep = useCallback((id) => {
    const restantes = steps.filter((s) => s.id !== id).map((s) => {
      let o = s;
      for (const saida of saidasDe(s)) if (saida.destino === id) o = ligarSaida(o, saida.handle, null);
      return o;
    });
    const pos = { ...posRef.current }; delete pos[id]; posRef.current = pos; gravarPosicoes(pos);
    onChange({ ...value, steps: restantes }); setSelId((cur) => (cur === id ? null : cur));
  }, [steps, value, onChange]);

  // ── Operações de nó (estilo n8n) ──────────────────────────────────────────
  const duplicar = useCallback((id) => {
    const orig = steps.find((s) => s.id === id); if (!orig) return;
    const novo = clonarSolto(orig);
    const base = posRef.current?.[id] ?? { x: 0, y: 0 };
    colocarPos(novo.id, { x: base.x + 40, y: base.y + 60 });
    onChange({ ...value, steps: [...steps, novo] });
    setSelId(novo.id);
  }, [steps, value, onChange, colocarPos]);

  const copiar = useCallback((id) => { const s = steps.find((x) => x.id === id); if (s) { gravarClip(s); setTemClip(true); } }, [steps]);
  const recortar = useCallback((id) => { copiar(id); delStep(id); }, [copiar, delStep]);
  const colar = useCallback(() => {
    const c = lerClip(); if (!c) return;
    const novo = clonarSolto(c);
    const base = posRef.current?.[selId] ?? { x: 40, y: 40 };
    colocarPos(novo.id, { x: base.x + 60, y: base.y + 40 });
    onChange({ ...value, steps: [...steps, novo] });
    setSelId(novo.id);
  }, [steps, value, onChange, selId, colocarPos]);

  const onNodesDelete = useCallback((apagados) => { for (const n of apagados) delStep(n.id); }, [delStep]);

  const onKeyDown = useCallback((e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "c" && selId) { e.preventDefault(); copiar(selId); }
    else if (k === "x" && selId) { e.preventDefault(); recortar(selId); }
    else if (k === "v") { e.preventDefault(); colar(); }
    else if (k === "d" && selId) { e.preventDefault(); duplicar(selId); }
  }, [selId, copiar, recortar, colar, duplicar]);

  const sel = steps.find((s) => s.id === selId) || null;
  const grupos = ["Mensagem", "Interativo", "Lógica", "Controle"];

  return (
    <div style={{ display: "flex", height: 640, border: "1px solid var(--border-soft)", borderRadius: 16, overflow: "hidden", background: "var(--bg-deep)" }}>
      {/* barra lateral de blocos — rolável, sempre visível */}
      <div style={{ width: 176, flex: "0 0 auto", borderRight: "1px solid var(--border-soft)", background: "var(--surface)", overflowY: "auto", padding: "10px 10px 14px" }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 }}>Blocos</div>
        {grupos.map((g) => (
          <div key={g} style={{ marginTop: 10 }}>
            <div style={{ fontSize: 10, color: "var(--text-faint)", fontWeight: 700, marginBottom: 2 }}>{g}</div>
            {KINDS.filter((k) => k.grupo === g).map((k) => (
              <button key={k.k} onClick={() => addStep(k.k)} title={`Adicionar ${k.label}`}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", borderRadius: 9, border: "1px solid var(--border-soft)", background: "var(--surface-2)", color: "var(--text)", cursor: "pointer", fontSize: 12, marginTop: 5, textAlign: "left" }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${k.cor} 16%, transparent)`, flex: "0 0 auto" }}>
                  <Ico d={k.icon} size={13} color={k.cor} />
                </span>
                {k.label}
              </button>
            ))}
          </div>
        ))}
        <button onClick={colar} disabled={!temClip} title="Colar bloco copiado (Ctrl+V)"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", padding: "8px", borderRadius: 9, border: "1px dashed var(--border)", background: "transparent", color: temClip ? "var(--text)" : "var(--text-faint)", cursor: temClip ? "pointer" : "not-allowed", fontSize: 12, marginTop: 14 }}>
          Colar bloco
        </button>
      </div>

      {/* área do canvas */}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }} tabIndex={0} onKeyDown={onKeyDown}>
        {/* contato de teste */}
        {!sel && (
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5, background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 12, padding: "7px 10px", boxShadow: "0 4px 16px rgba(0,0,0,.14)", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Teste</span>
            <input value={testNome} onChange={(e) => setTestNome(e.target.value)} placeholder="Nome"
              style={{ width: 120, fontSize: 12, padding: "5px 8px", borderRadius: 8 }} />
          </div>
        )}

        <ReactFlow
          nodes={nodes} edges={edges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onEdgesDelete={onEdgesDelete} onNodesDelete={onNodesDelete}
          onNodeClick={(_e, n) => setSelId(n.id)} onNodeDragStop={onNodeDragStop}
          onPaneClick={() => setSelId(null)} fitView proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1.5} color="var(--border-soft)" />
          <Controls showInteractive={false} style={{ borderRadius: 10, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,.14)" }} />
          <MiniMap pannable zoomable nodeColor={(n) => corDe(n.data?.step ?? {})} style={{ background: "var(--surface-2)", borderRadius: 10 }} />
        </ReactFlow>

        {/* painel de propriedades flutuante */}
        {sel && (
          <div style={{ position: "absolute", top: 12, right: 12, bottom: 12, width: 288, zIndex: 6, background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 14, boxShadow: "0 8px 30px rgba(0,0,0,.22)", overflowY: "auto", padding: 14 }}>
            <PropertyPanel step={sel} vars={vars} isStart={sel.id === inicioId} onSetStart={() => setStart(sel.id)}
              onPatch={(fn) => mutarStep(sel.id, fn)} onDelete={() => delStep(sel.id)} onClose={() => setSelId(null)}
              onDuplicate={() => duplicar(sel.id)} onCopy={() => copiar(sel.id)} onCut={() => recortar(sel.id)}
              problemas={problemas.filter((p) => p.stepId === sel.id)} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Painel de propriedades ───────────────────────────────────────────────────
function PropertyPanel({ step, vars, isStart, onSetStart, onPatch, onDelete, onClose, onDuplicate, onCopy, onCut, problemas }) {
  const patch = (campos) => onPatch((s) => ({ ...s, ...campos }));
  const meta = kindMeta(step.kind);
  const cor = corDe(step);
  const lbl = { fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 14, display: "block" };
  const inp = { width: "100%", marginTop: 5, fontSize: 13, padding: "8px 10px", borderRadius: 9 };

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 24, height: 24, borderRadius: 8, display: "grid", placeItems: "center", background: `color-mix(in srgb, ${cor} 16%, transparent)` }}><Ico d={meta.icon} size={14} color={cor} /></span>
        <span style={{ fontWeight: 700 }}>{meta.label}</span>
        <code style={{ fontSize: 10, color: "var(--text-faint)" }}>{step.id}</code>
        <span style={{ flex: 1 }} />
        <button className="btn-ghost mini" onClick={onClose} title="Fechar">✕</button>
      </div>

      {/* ações do nó estilo n8n */}
      <div style={{ marginTop: 10, display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button className="btn-ghost mini" onClick={onDuplicate} title="Duplicar (Ctrl+D)">Duplicar</button>
        <button className="btn-ghost mini" onClick={onCopy} title="Copiar (Ctrl+C)">Copiar</button>
        <button className="btn-ghost mini" onClick={onCut} title="Recortar (Ctrl+X)">Recortar</button>
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {isStart
          ? <span className="badge badge-green" style={{ fontSize: 10 }}>▶ início</span>
          : <button className="btn-ghost mini" onClick={onSetStart}>Tornar início</button>}
        <button className="btn-ghost mini" style={{ color: "var(--red)" }} onClick={onDelete} title="Excluir (Del)">Excluir</button>
      </div>

      {/* nome + cor do bloco */}
      <label style={lbl}>Nome do bloco (opcional)</label>
      <input value={step.nome ?? ""} onChange={(e) => patch({ nome: e.target.value || undefined })} style={inp} placeholder={meta.label} />
      <label style={lbl}>Cor</label>
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <button onClick={() => patch({ cor: undefined })} title="Cor padrão do tipo"
          style={{ width: 26, height: 26, borderRadius: 7, cursor: "pointer", display: "grid", placeItems: "center", background: "var(--surface-2)", border: !step.cor ? "2px solid var(--text)" : "1px solid var(--border)", fontSize: 10, color: "var(--text-faint)" }}>A</button>
        {CORES.map((c) => (
          <button key={c} onClick={() => patch({ cor: c })} title={c}
            style={{ width: 26, height: 26, borderRadius: 7, cursor: "pointer", background: c, border: step.cor === c ? "2px solid var(--text)" : "1px solid var(--border)" }} />
        ))}
      </div>

      {(step.kind === "text" || step.kind === "buttons" || step.kind === "list" || step.kind === "media" || step.kind === "cta" || step.kind === "input") && (
        <>
          <label style={lbl}>{step.kind === "media" ? "Legenda" : step.kind === "input" ? "Pergunta" : "Mensagem"}</label>
          <textarea value={step.text ?? ""} onChange={(e) => patch({ text: e.target.value })} placeholder="Use {{primeiro_nome}}…" style={{ ...inp, minHeight: 72, resize: "vertical" }} />
          {String(step.text ?? "").includes("{{") && (
            <div style={{ marginTop: 6, padding: "6px 9px", borderRadius: 8, background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)" }}>
              <span style={{ color: "var(--text-faint)" }}>Prévia: </span>{interpolate(step.text, vars) || "(vazio)"}
            </div>
          )}
        </>
      )}

      {step.kind === "media" && (
        <>
          <label style={lbl}>Tipo</label>
          <select value={step.media?.type ?? "image"} onChange={(e) => patch({ media: { ...(step.media ?? {}), type: e.target.value } })} style={inp}>
            {["image", "video", "audio", "document"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label style={lbl}>URL do arquivo</label>
          <input value={step.media?.url ?? ""} onChange={(e) => patch({ media: { ...(step.media ?? {}), url: e.target.value } })} style={inp} placeholder="https://…" />
        </>
      )}

      {step.kind === "buttons" && (
        <>
          <label style={lbl}>Imagem no topo (opcional)</label>
          <input value={step.imageUrl ?? ""} onChange={(e) => patch({ imageUrl: e.target.value || undefined })} style={inp} placeholder="https://… (header do cartão)" />
          <label style={lbl}>Botões (máx 3)</label>
          {(step.buttons ?? []).map((b, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginTop: 5 }}>
              <input value={b.title} onChange={(e) => patch({ buttons: step.buttons.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} style={{ ...inp, marginTop: 0 }} placeholder="título" />
              <button className="btn-ghost mini" onClick={() => patch({ buttons: step.buttons.filter((_, j) => j !== i) })}>×</button>
            </div>
          ))}
          {(step.buttons?.length ?? 0) < 3 && (
            <button className="btn-ghost mini" style={{ marginTop: 6 }} onClick={() => patch({ buttons: [...(step.buttons ?? []), { id: "b" + ((step.buttons?.length ?? 0) + 1), title: "Nova opção" }] })}>+ botão</button>
          )}
        </>
      )}

      {step.kind === "list" && (() => {
        const sections = step.sections ?? [];
        const totalRows = sections.reduce((count, section) => count + (section.rows?.length ?? 0), 0);
        const setSections = (nextSections, removedRowIds = []) => {
          const branches = { ...(step.branches ?? {}) };
          for (const id of removedRowIds) delete branches[id];
          patch({
            sections: nextSections,
            ...(removedRowIds.length ? { branches } : {}),
          });
        };
        const updateSection = (sectionIndex, changes, removedRowIds = []) => setSections(
          sections.map((section, index) => index === sectionIndex ? { ...section, ...changes } : section),
          removedRowIds,
        );
        const addRow = (sectionIndex) => {
          const usedIds = new Set(sections.flatMap((section) => (section.rows ?? []).map((row) => row.id)));
          let id;
          do { id = "r_" + Math.random().toString(36).slice(2, 10); } while (usedIds.has(id));
          updateSection(sectionIndex, {
            rows: [...(sections[sectionIndex].rows ?? []), { id, title: "" }],
          });
        };
        return (
          <>
            <label style={lbl}>Seções e itens da lista (máx. 10 itens no total)</label>
            {sections.map((section, sectionIndex) => (
              <div key={sectionIndex} style={{ marginTop: 8, padding: 10, border: "1px solid var(--border)", borderRadius: 9 }}>
                <label style={lbl}>Título da seção</label>
                <input value={section.title ?? ""} onChange={(e) => updateSection(sectionIndex, { title: e.target.value })} style={inp} placeholder="Ex.: Cursos" maxLength={24} />
                {(section.rows ?? []).map((row, rowIndex) => (
                  <div key={row.id} style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-soft)" }}>
                    <label style={lbl}>Item {rowIndex + 1}</label>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={row.title ?? ""} onChange={(e) => updateSection(sectionIndex, {
                        rows: section.rows.map((item, index) => index === rowIndex ? { ...item, title: e.target.value } : item),
                      })} style={{ ...inp, marginTop: 0, flex: 1 }} placeholder="Nome da opção" maxLength={24} />
                      <button className="btn-ghost mini" title="Excluir item" onClick={() => updateSection(sectionIndex, {
                        rows: section.rows.filter((_, index) => index !== rowIndex),
                      }, [row.id])}>×</button>
                    </div>
                    <input value={row.description ?? ""} onChange={(e) => updateSection(sectionIndex, {
                      rows: section.rows.map((item, index) => index === rowIndex ? { ...item, description: e.target.value } : item),
                    })} style={inp} placeholder="Descrição (opcional)" maxLength={72} />
                  </div>
                ))}
                {totalRows < 10 && <button className="btn-ghost mini" style={{ marginTop: 8 }} onClick={() => addRow(sectionIndex)}>+ item</button>}
                <button className="btn-ghost mini" style={{ marginTop: 8, marginLeft: 6 }} onClick={() => setSections(
                  sections.filter((_, index) => index !== sectionIndex),
                  (section.rows ?? []).map((row) => row.id),
                )}>Excluir seção</button>
              </div>
            ))}
            {sections.length < 10 && <button className="btn-ghost mini" style={{ marginTop: 8 }} onClick={() => setSections([
              ...sections,
              { title: "", rows: [] },
            ])}>+ seção</button>}
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
              Escreva a mensagem acima e conecte a saída de cada item ao próximo bloco.
            </div>
          </>
        );
      })()}

      {step.kind === "cta" && (
        <>
          <label style={lbl}>Texto do botão</label>
          <input value={step.ctaText ?? ""} onChange={(e) => patch({ ctaText: e.target.value })} style={inp} placeholder="Abrir (máx 20)" maxLength={20} />
          <label style={lbl}>Link (URL)</label>
          <input value={step.ctaUrl ?? ""} onChange={(e) => patch({ ctaUrl: e.target.value })} style={inp} placeholder="https://…" />
        </>
      )}

      {step.kind === "input" && (() => {
        const inv = step.input ?? { var: "", tipo: "texto" };
        const setIn = (campos) => patch({ input: { ...inv, ...campos } });
        const slug = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
        return (
          <>
            <label style={lbl}>Guardar a resposta na variável</label>
            <input value={inv.var ?? ""} onChange={(e) => setIn({ var: slug(e.target.value) })} style={inp} placeholder="nome_completo, cidade, email…" />
            <label style={lbl}>Tipo da resposta</label>
            <select value={inv.tipo ?? "texto"} onChange={(e) => setIn({ tipo: e.target.value })} style={inp}>
              <option value="texto">Texto</option>
              <option value="numero">Número (só dígitos)</option>
            </select>
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Manda a pergunta, <b>espera o lead digitar</b> e guarda em <code>{`{{${inv.var || "var"}}}`}</code> (fica no contato, reutilizável). Os próximos blocos podem usar <code>{`{{${inv.var || "var"}}}`}</code>. Não ramifica — liga a saída <b>resposta → segue</b>.
            </div>
          </>
        );
      })()}

      {step.kind === "condition" && (() => {
        const c = step.cond ?? { field: "nome", op: "existe" };
        const setC = (campos) => patch({ cond: { ...c, ...campos } });
        const semValor = c.op === "existe" || c.op === "vazio";
        return (
          <>
            <label style={lbl}>Se o campo</label>
            <select value={c.field} onChange={(e) => setC({ field: e.target.value })} style={inp}>
              {VARS_DISPONIVEIS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <label style={lbl}>Operador</label>
            <select value={c.op} onChange={(e) => setC({ op: e.target.value })} style={inp}>
              {[["igual", "é igual a"], ["diferente", "é diferente de"], ["contem", "contém"], ["existe", "está preenchido"], ["vazio", "está vazio"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {!semValor && (<><label style={lbl}>Valor</label><input value={c.value ?? ""} onChange={(e) => setC({ value: e.target.value })} style={inp} placeholder="texto a comparar" /></>)}
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-faint)" }}>Saídas: <b style={{ color: "var(--green)" }}>sim</b> / <b style={{ color: "var(--red)" }}>não</b> — ligue cada uma a um bloco.</div>
          </>
        );
      })()}

      {step.kind === "transfer" && (
        <>
          <label style={lbl}>Mensagem de transferência</label>
          <textarea value={step.text ?? ""} onChange={(e) => patch({ text: e.target.value })} style={{ ...inp, minHeight: 60, resize: "vertical" }} placeholder="Um atendente vai continuar daqui 👋" />
          <label style={lbl}>Encaminhar pro time (ID do Chatwoot) — opcional</label>
          <input type="number" min={1} value={step.transferTeamId ?? ""} onChange={(e) => patch({ transferTeamId: e.target.value === "" ? undefined : Number(e.target.value) })} style={inp} placeholder="ex.: 3 (time Comercial)" />

          <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 7, marginTop: 12, cursor: "pointer" }}>
            <input type="checkbox" checked={!!step.qualificarIA} onChange={(e) => patch({ qualificarIA: e.target.checked ? true : undefined })} />
            Qualificar com IA (Jev): temperatura do lead na nota
          </label>
          <label style={{ ...lbl, display: "flex", alignItems: "center", gap: 7, marginTop: 8, cursor: step.qualificarIA ? "not-allowed" : "pointer", opacity: step.qualificarIA ? 0.5 : 1 }}>
            <input type="checkbox" disabled={!!step.qualificarIA} checked={!!step.resumo || !!step.qualificarIA} onChange={(e) => patch({ resumo: e.target.checked ? true : undefined })} />
            Enviar resumo do lead pro consultor (nota privada)
          </label>
          {step.resumo && !step.qualificarIA && (
            <>
              <label style={lbl}>Modelo do resumo — vazio = automático (dados capturados + etiquetas)</label>
              <textarea
                value={typeof step.resumo === "string" ? step.resumo : ""}
                onChange={(e) => patch({ resumo: e.target.value.trim() ? e.target.value : true })}
                style={{ ...inp, minHeight: 72, resize: "vertical" }}
                placeholder={"Automático. Ou escreva um modelo, ex.:\n📋 Lead: {{nome_completo}} · {{cidade}} · {{email}}"}
              />
            </>
          )}

          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Ao chegar aqui: manda a mensagem, <b>silencia o bot</b> (etiqueta <code>bot-off</code>) e encerra o fluxo. Com o <b>ID do time</b>, encaminha a conversa pra fila daquele time no Chatwoot (precisa de conversa aberta). O ID você pega em Configurações → Times no Chatwoot. O <b>resumo</b> vai como nota privada (só o time vê) com nome, cidade, nota do ENEM e as etiquetas do funil. Com <b>Qualificar com IA</b>, o Jev classifica a temperatura do lead (🔥 quente / 🌤️ morno / ❄️ frio) no topo da nota — e já inclui os dados (dispensa marcar o resumo).
          </div>
        </>
      )}

      {step.kind === "ai" && (() => {
        const ai = step.ai ?? { opcoes: [] };
        const setAi = (campos) => patch({ ai: { ...ai, ...campos } });
        const setOp = (i, campos) => setAi({ opcoes: ai.opcoes.map((o, j) => j === i ? { ...o, ...campos } : o) });
        return (
          <>
            <label style={lbl}>Pergunta ao cliente</label>
            <textarea value={step.text ?? ""} onChange={(e) => patch({ text: e.target.value })} style={{ ...inp, minHeight: 54, resize: "vertical" }} placeholder="Como posso te ajudar?" />
            <label style={lbl}>Instrução pro Jev (o que classificar)</label>
            <textarea value={ai.instrucao ?? ""} onChange={(e) => setAi({ instrucao: e.target.value })} style={{ ...inp, minHeight: 44, resize: "vertical" }} placeholder="Classifique a intenção da mensagem." />
            <label style={lbl}>Opções (o Jev escolhe uma)</label>
            {(ai.opcoes ?? []).map((o, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginTop: 5, alignItems: "center" }}>
                <input value={o.titulo ?? ""} onChange={(e) => setOp(i, { titulo: e.target.value })} style={{ ...inp, marginTop: 0, flex: 1 }} placeholder="título" />
                <input value={o.descricao ?? ""} onChange={(e) => setOp(i, { descricao: e.target.value })} style={{ ...inp, marginTop: 0, flex: 1.6 }} placeholder="descrição (ajuda o Jev)" />
                <button className="btn-ghost mini" onClick={() => setAi({ opcoes: ai.opcoes.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            <button className="btn-ghost mini" style={{ marginTop: 6 }} onClick={() => setAi({ opcoes: [...(ai.opcoes ?? []), { id: "op" + ((ai.opcoes?.length ?? 0) + 1), titulo: "Nova opção" }] })}>+ opção</button>
            <label style={lbl}>Confiança mínima (0 a 1)</label>
            <input type="number" min={0} max={1} step={0.05} value={ai.minConfianca ?? 0.6} onChange={(e) => setAi({ minConfianca: Number(e.target.value) })} style={inp} />
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              O Jev classifica a resposta livre numa opção. Confiança abaixo do mínimo → saída <b style={{ color: "var(--amber)" }}>baixa confiança</b> (ligue a Transferir humano). Precisa da env <code>TYPESAFE_API_KEY</code> no bridge.
            </div>
          </>
        );
      })()}

      {step.kind === "action" && (() => {
        const a = step.contatoAcao ?? {};
        const setA = (campos) => patch({ contatoAcao: { ...a, ...campos } });
        const lista = (txt) => txt.split(",").map((s) => s.trim()).filter(Boolean);
        return (
          <>
            <label style={lbl}>Adicionar etiquetas (vírgula)</label>
            <input value={(a.addLabels ?? []).join(", ")} onChange={(e) => setA({ addLabels: lista(e.target.value) })} style={inp} placeholder="quente, cliente" />
            <label style={lbl}>Remover etiquetas (vírgula)</label>
            <input value={(a.removeLabels ?? []).join(", ")} onChange={(e) => setA({ removeLabels: lista(e.target.value) })} style={inp} placeholder="frio" />
            <label style={lbl}>Definir nome do contato (opcional)</label>
            <input value={a.setNome ?? ""} onChange={(e) => setA({ setNome: e.target.value })} style={inp} placeholder="{{primeiro_nome}} ou texto fixo" />
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Mexe no contato <b>sem mandar mensagem</b> e segue. Etiquetas vão pra conversa no Chatwoot (precisa de conversa aberta).
            </div>
          </>
        );
      })()}

      {step.kind === "api" && (() => {
        const api = step.api ?? {};
        const setApi = (campos) => patch({ api: { ...api, ...campos } });
        const headersTxt = Object.entries(api.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
        const parseHeaders = (txt) => {
          const h = {};
          for (const linha of txt.split("\n")) {
            const i = linha.indexOf(":");
            if (i > 0) { const k = linha.slice(0, i).trim(); const v = linha.slice(i + 1).trim(); if (k) h[k] = v; }
          }
          return h;
        };
        return (
          <>
            <label style={lbl}>Método</label>
            <select value={api.method ?? "POST"} onChange={(e) => setApi({ method: e.target.value })} style={inp}>
              <option value="POST">POST</option><option value="GET">GET</option>
            </select>
            <label style={lbl}>URL (destino pré-aprovado)</label>
            <input value={api.url ?? ""} onChange={(e) => setApi({ url: e.target.value })} style={inp} placeholder="https://seu-n8n.exemplo.com/webhook/..." />
            <label style={lbl}>Headers (um por linha: Nome: valor)</label>
            <textarea value={headersTxt} onChange={(e) => setApi({ headers: parseHeaders(e.target.value) })} style={{ ...inp, minHeight: 44, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} placeholder={"Authorization: Bearer {{env.N8N_TOKEN}}"} />
            <label style={lbl}>Corpo (POST) — vazio = JSON dos dados do contato</label>
            <textarea value={api.bodyTemplate ?? ""} onChange={(e) => setApi({ bodyTemplate: e.target.value })} style={{ ...inp, minHeight: 44, resize: "vertical", fontFamily: "monospace", fontSize: 12 }} placeholder={'{"telefone":"{{telefone}}","nome":"{{nome}}"}'} />
            <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Dispara e segue (não espera resposta). Só chama hosts da env <code>FLOW_API_ALLOWLIST</code> (vazia = bloqueia tudo). Segredo em header via <code>{"{{env.NOME}}"}</code> — nunca escreva o token aqui.
            </div>
          </>
        );
      })()}

      {step.kind === "goto" && (
        <>
          <label style={lbl}>ID do fluxo de destino (da Biblioteca)</label>
          <input value={step.gotoFlowId ?? ""} onChange={(e) => patch({ gotoFlowId: e.target.value })} style={inp} placeholder="cole o ID do fluxo publicado" />
          <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.3)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Salta pra outro fluxo <b>publicado</b> (segue a versão publicada no momento do salto). Só executa com a migration <code>0018</code> aplicada <b>e</b> <code>FLOW_GOTO_ENABLED=true</code> no bridge; sem isso, o nó encerra o fluxo e loga o destino.
          </div>
        </>
      )}

      {step.kind === "wait" && (<><label style={lbl}>Minutos de pausa</label><input type="number" min={0} value={step.minutes ?? 0} onChange={(e) => patch({ minutes: Number(e.target.value) })} style={inp} /></>)}

      {["text", "media", "buttons", "list", "cta", "ai", "input", "transfer"].includes(step.kind) && (
        <>
          <label style={lbl}>Pausa antes de enviar (seg) — efeito "digitando"</label>
          <input type="number" min={0} max={20} value={step.delaySeg ?? ""} onChange={(e) => patch({ delaySeg: e.target.value === "" ? undefined : Number(e.target.value) })} style={inp} placeholder="0 = sem pausa" />
        </>
      )}

      {ESPERA.has(step.kind) && (<><label style={lbl}>Timeout (min) — vazio = espera sempre</label><input type="number" min={0} value={step.timeoutMin ?? ""} onChange={(e) => patch({ timeoutMin: e.target.value === "" ? undefined : Number(e.target.value) })} style={inp} /></>)}

      {step.kind === "end" && (
        <>
          <label style={lbl}>Desfecho</label>
          <select value={step.outcome ?? ""} onChange={(e) => patch({ outcome: e.target.value || undefined })} style={inp}>
            <option value="">(nenhum)</option><option value="won">won</option><option value="lost">lost</option>
          </select>
        </>
      )}

      {problemas.length > 0 && (
        <div style={{ marginTop: 14, padding: 10, borderRadius: 9, background: "rgba(251,93,118,.1)", border: "1px solid rgba(251,93,118,.3)" }}>
          {problemas.map((p, i) => <div key={i} style={{ fontSize: 11, color: "var(--red)", marginTop: i ? 3 : 0 }}>{p.problema}</div>)}
        </div>
      )}

      <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid var(--border-soft)", fontSize: 10, color: "var(--text-faint)", lineHeight: 1.6 }}>
        Variáveis: {VARS_DISPONIVEIS.map((v) => <code key={v} style={{ color: "var(--mint)", marginRight: 4 }}>{`{{${v}}}`}</code>)}
      </div>
    </div>
  );
}

export default function FlowCanvas(props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
