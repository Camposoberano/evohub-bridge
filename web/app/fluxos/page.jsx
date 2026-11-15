"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

// Lazy-load: FlowCanvas arrasta o React Flow (~75kB). Carrega só quando o editor aparece, em vez
// de pesar o primeiro paint de /fluxos. ssr:false — é client puro (canvas + localStorage).
const FlowCanvas = dynamic(() => import("@/components/FlowCanvas"), {
  ssr: false,
  loading: () => <div className="editor-skeleton">Carregando editor…</div>,
});
const FlowSimulator = dynamic(() => import("@/components/FlowSimulator"), { ssr: false });

// Fase 1 do Editor Visual de Fluxos. Enquanto a flag estiver desligada, a tela é a de sempre
// (textarea JSON + desenho read-only). Ligada, aparece o canvas React Flow editável, two-way
// com o JSON. Nenhum envio novo: o disparo de teste continua sendo o mesmo botão de antes.
const EDITOR_V2 = process.env.NEXT_PUBLIC_FLOW_EDITOR_V2 === "1" || process.env.NEXT_PUBLIC_FLOW_EDITOR_V2 === "true";

// Espelha shared/flow.ts. Só o que o editor precisa saber para desenhar e avisar de erro —
// a validação que vale é a do bridge, que recusa o disparo. Aqui é para o erro aparecer
// enquanto se monta, não depois de mandar para 2 mil pessoas.
const KINDS = [
  { k: "text", label: "Texto", cor: "var(--blue)" },
  { k: "media", label: "Mídia", cor: "var(--amber)" },
  { k: "buttons", label: "Botões", cor: "var(--mint)" },
  { k: "list", label: "Lista", cor: "var(--mint)" },
  { k: "wait", label: "Pausa", cor: "var(--text-faint)" },
  { k: "end", label: "Fim", cor: "var(--green)" },
];
const ESPERA = new Set(["buttons", "list", "ai", "input"]);

function alvosDeRamificacao(steps) {
  const alvos = new Set();
  for (const s of steps) {
    for (const d of Object.values(s.branches ?? {})) alvos.add(d);
    if (s.fallbackNext) alvos.add(s.fallbackNext);
    if (s.onTimeout) alvos.add(s.onTimeout);
  }
  return alvos;
}

/** Mesma regra do motor: step alvo de ramificação começa um ramo e não é alcançado pela ordem. */
function proximoNaOrdem(steps, id) {
  const i = steps.findIndex((s) => s.id === id);
  if (i < 0 || i + 1 >= steps.length) return null;
  const prox = steps[i + 1];
  return alvosDeRamificacao(steps).has(prox.id) ? null : prox.id;
}

function validar(flow) {
  const problemas = [];
  const steps = flow?.steps ?? [];
  if (!steps.length) return [{ stepId: "(fluxo)", problema: "fluxo sem nenhum step" }];
  const ids = new Set();
  for (const s of steps) {
    if (!s.id) problemas.push({ stepId: "(sem id)", problema: "step sem id" });
    if (ids.has(s.id)) problemas.push({ stepId: s.id, problema: "id repetido" });
    ids.add(s.id);
  }
  for (const s of steps) {
    const destinos = [s.next, s.fallbackNext, s.onTimeout, ...Object.values(s.branches ?? {})].filter(Boolean);
    for (const d of destinos) {
      if (!ids.has(d)) problemas.push({ stepId: s.id, problema: `aponta para "${d}", que não existe` });
    }
    if (s.kind === "buttons") {
      if (!s.buttons?.length) problemas.push({ stepId: s.id, problema: "botões vazios" });
      if ((s.buttons?.length ?? 0) > 3) problemas.push({ stepId: s.id, problema: `${s.buttons.length} botões; o WhatsApp aceita 3` });
      const titulos = (s.buttons ?? []).map((b) => (b.title ?? "").trim().toLowerCase());
      if (new Set(titulos).size !== titulos.length) problemas.push({ stepId: s.id, problema: "títulos de botão repetidos — a Meta exige únicos" });
      if ((s.text?.length ?? 0) > 1024) problemas.push({ stepId: s.id, problema: `texto com ${s.text.length} caracteres; limite 1024` });
    }
    if (s.kind === "list") {
      const secs = s.sections ?? [];
      if (secs.length > 10) problemas.push({ stepId: s.id, problema: `${secs.length} seções; o WhatsApp aceita 10` });
      const totalLinhas = secs.reduce((n, sec) => n + (sec.rows?.length ?? 0), 0);
      if (totalLinhas === 0) problemas.push({ stepId: s.id, problema: "lista sem nenhuma linha" });
      if (totalLinhas > 10) problemas.push({ stepId: s.id, problema: `${totalLinhas} linhas no total; o WhatsApp aceita 10 somando todas as seções` });
      if ((s.text?.length ?? 0) > 1024) problemas.push({ stepId: s.id, problema: `texto com ${s.text.length} caracteres; limite 1024` });
    }
    if (s.kind === "media" && !s.media?.url) problemas.push({ stepId: s.id, problema: "mídia sem url" });
    if (s.kind === "condition") {
      if (!s.cond?.field) problemas.push({ stepId: s.id, problema: "condição sem campo" });
      if (s.cond && ["igual", "diferente", "contem"].includes(s.cond.op) && !s.cond.value?.trim()) problemas.push({ stepId: s.id, problema: "condição sem valor" });
      if (!s.branches?.sim && !s.branches?.nao) problemas.push({ stepId: s.id, problema: "condição sem saída sim/não ligada" });
    }
    if (s.kind === "ai") {
      if (!s.text?.trim()) problemas.push({ stepId: s.id, problema: "agente IA sem a pergunta" });
      const ops = s.ai?.opcoes ?? [];
      if (ops.length < 2) problemas.push({ stepId: s.id, problema: "agente IA precisa de 2+ opções" });
      for (const o of ops) if (o.id && !s.branches?.[o.id]) problemas.push({ stepId: s.id, problema: `opção "${o.titulo ?? o.id}" sem ramo` });
      if (!s.branches?.fallback) problemas.push({ stepId: s.id, problema: "agente IA sem saída de baixa confiança ligada" });
    }
    if (s.kind === "cta") {
      if (!s.text?.trim()) problemas.push({ stepId: s.id, problema: "botão de link sem mensagem" });
      if (!s.ctaText?.trim()) problemas.push({ stepId: s.id, problema: "botão de link sem texto do botão" });
      if (!s.ctaUrl?.trim()) problemas.push({ stepId: s.id, problema: "botão de link sem URL" });
      else if (!/^https?:\/\//i.test(s.ctaUrl.trim())) problemas.push({ stepId: s.id, problema: "URL deve começar com http(s)://" });
    }
    if (s.kind === "action") {
      const a = s.contatoAcao ?? {};
      const temAlgo = (a.addLabels?.length ?? 0) > 0 || (a.removeLabels?.length ?? 0) > 0 || !!a.setNome?.trim();
      if (!temAlgo) problemas.push({ stepId: s.id, problema: "ação de contato sem nada a fazer (etiqueta ou nome)" });
    }
    if (s.kind === "api") {
      const u = s.api?.url?.trim() ?? "";
      if (!u) problemas.push({ stepId: s.id, problema: "chamada API sem URL" });
      else if (!/^https?:\/\//i.test(u)) problemas.push({ stepId: s.id, problema: "URL da chamada API deve começar com http(s)://" });
    }
    if (s.kind === "goto" && !s.gotoFlowId?.trim()) problemas.push({ stepId: s.id, problema: "ir-para-fluxo sem fluxo de destino" });
    if (s.kind === "input") {
      if (!s.text?.trim()) problemas.push({ stepId: s.id, problema: "pergunta aberta sem a mensagem" });
      if (!s.input?.var?.trim()) problemas.push({ stepId: s.id, problema: "pergunta aberta sem a variável onde guardar a resposta" });
      else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s.input.var.trim())) problemas.push({ stepId: s.id, problema: `variável "${s.input.var}" inválida — letras, números e _ (sem espaço/acento)` });
      if (!s.next && !s.fallbackNext) problemas.push({ stepId: s.id, problema: "pergunta aberta sem próximo passo (ligue 'resposta → segue')" });
    }
    if (s.kind === "text" && !s.text?.trim()) problemas.push({ stepId: s.id, problema: "texto vazio" });
    if (s.kind === "text" && (s.text?.length ?? 0) > 4096) problemas.push({ stepId: s.id, problema: `texto com ${s.text.length} caracteres; limite 4096` });
    if (s.timeoutMin !== undefined && !s.onTimeout) {
      problemas.push({ stepId: s.id, problema: "timeoutMin sem onTimeout — o lead ficaria esperando para sempre" });
    }
  }
  // ciclo sem pergunta: mandaria mensagem até a conta cair
  for (const inicio of steps) {
    if (ESPERA.has(inicio.kind) || inicio.kind === "wait") continue;
    const visto = new Set([inicio.id]);
    let atual = inicio;
    while (atual) {
      if (ESPERA.has(atual.kind) || atual.kind === "wait" || atual.kind === "end" || atual.kind === "goto") break;
      const proxId = atual.next ?? proximoNaOrdem(steps, atual.id);
      if (!proxId) break;
      if (visto.has(proxId)) {
        problemas.push({ stepId: inicio.id, problema: `ciclo sem pergunta (volta em "${proxId}") — mandaria mensagem sem parar` });
        break;
      }
      visto.add(proxId);
      atual = steps.find((s) => s.id === proxId);
    }
  }
  return problemas;
}

/** Para onde este step leva, com o rótulo de cada saída. Alimenta o desenho. */
function saidasDe(steps, s) {
  const saidas = [];
  for (const [botao, destino] of Object.entries(s.branches ?? {})) {
    const bt = s.buttons?.find((b) => b.id === botao);
    saidas.push({ rotulo: bt?.title ?? botao, destino, tipo: "botao" });
  }
  if (s.fallbackNext) saidas.push({ rotulo: "digitou texto", destino: s.fallbackNext, tipo: "fallback" });
  if (s.onTimeout) saidas.push({ rotulo: `sem resposta (${s.timeoutMin}min)`, destino: s.onTimeout, tipo: "timeout" });
  const seq = s.next ?? proximoNaOrdem(steps, s.id);
  if (seq && !ESPERA.has(s.kind)) saidas.push({ rotulo: "segue", destino: seq, tipo: "seq" });
  return saidas;
}

function resumo(s) {
  if (s.kind === "media") return `${s.media?.type ?? "mídia"} — ${s.media?.url ?? "(sem url)"}`;
  if (s.kind === "wait") return `pausa de ${s.minutes ?? 0} min`;
  if (s.kind === "end") return s.outcome ? `encerra como ${s.outcome}` : "encerra o fluxo";
  return s.text ?? "";
}

// ── Configuração de disparo (ritmo da campanha) ──────────────────────────────
// Espelha shared/campaign-pace.ts PaceConfig. Guardado em flow.disparo (viaja com o fluxo,
// salva na biblioteca) e enviado como `pace` no agendar-fluxo. Vazio = backend usa PACE_PADRAO.
const DISPARO_PADRAO = { modo: "rampa", capInicial: 50, capIncremento: 10, capMaximo: 200, horaInicio: 8, horaFim: 17 };

/** flow.disparo (UI) → PaceConfig (bridge). modo "fixo" = mesmo volume todo dia (sem rampa). */
function paceDoFluxo(d) {
  if (!d) return undefined;
  const fixo = d.modo === "fixo";
  const inicial = Number(d.capInicial ?? DISPARO_PADRAO.capInicial);
  return {
    capInicial: inicial,
    capIncremento: fixo ? 0 : Number(d.capIncremento ?? DISPARO_PADRAO.capIncremento),
    capMaximo: fixo ? inicial : Number(d.capMaximo ?? DISPARO_PADRAO.capMaximo),
    horaInicio: Number(d.horaInicio ?? DISPARO_PADRAO.horaInicio),
    horaFim: Number(d.horaFim ?? DISPARO_PADRAO.horaFim),
  };
}

/** Confirmação amigável do disparo (sem JSON na cara). Mostra ok/erro e detalhes só se abrir. */
function ResultadoDisparo({ resultado }) {
  if (!resultado) return null;
  const erro = resultado.error;
  const n = resultado.agendados ?? resultado.fila ?? resultado.enfileirados ?? resultado.count ?? resultado.total ?? null;
  return (
    <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 10,
      background: erro ? "rgba(251,93,118,.1)" : "rgba(46,204,113,.1)",
      border: `1px solid ${erro ? "rgba(251,93,118,.3)" : "rgba(46,204,113,.3)"}` }}>
      <div style={{ fontWeight: 800, fontSize: 13.5, color: erro ? "var(--red)" : "var(--green)" }}>
        {erro ? "✕ Não disparou" : "✓ Fluxo ok — disparo criado"}
        {!erro && n != null && <span style={{ fontWeight: 600, color: "var(--text-dim)" }}> · {n} na fila</span>}
      </div>
      {erro && <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 4 }}>{String(erro)}</div>}
      {!erro && <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 4 }}>Acompanhe em “Contatos dentro de um fluxo”, abaixo.</div>}
      <details style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--text-faint)" }}>detalhes técnicos</summary>
        <pre style={{ marginTop: 6, padding: 10, borderRadius: 8, background: "var(--bg-deep)", border: "1px solid var(--border)", fontSize: 11, overflowX: "auto", color: "var(--text-dim)" }}>
          {JSON.stringify(resultado, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export default function Fluxos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [texto, setTexto] = useState("");
  const [numeros, setNumeros] = useState("");
  const [canais, setCanais] = useState([]);
  const [canalId, setCanalId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [emAndamento, setEmAndamento] = useState([]);
  const [forcarTeste, setForcarTeste] = useState(false);
  // Biblioteca de fluxos (flow_definitions + flow_versions)
  const [biblioteca, setBiblioteca] = useState([]);
  const [fluxoId, setFluxoId] = useState(null);
  const [fluxoNome, setFluxoNome] = useState("");
  const [fluxoInfo, setFluxoInfo] = useState(null); // { status, current_version }
  const [libMsg, setLibMsg] = useState("");
  const [salvandoFluxo, setSalvandoFluxo] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setPronto(true);
    });
  }, [router]);

  const carregar = useCallback(async () => {
    const { data: chs } = await supabase.from("channels")
      .select("id,name,phone_number").eq("type", "whatsapp").order("name");
    setCanais(chs ?? []);
    if (chs?.length && !canalId) setCanalId(chs[0].id);
    const { data: st } = await supabase.schema("public").from("campaign_flow_state")
      .select("campaign_id,contact_key,step_id,status,waiting_since,updated_at")
      .order("updated_at", { ascending: false }).limit(30);
    setEmAndamento(st ?? []);
  }, [canalId]);

  useEffect(() => { if (pronto) carregar(); }, [pronto, carregar]);

  const flow = useMemo(() => {
    if (!texto.trim()) return null;
    try { return JSON.parse(texto); } catch { return "erro"; }
  }, [texto]);

  const jsonInvalido = flow === "erro";
  const steps = jsonInvalido || !flow ? [] : (flow.steps ?? flow.flow?.steps ?? []);
  const problemas = useMemo(() => (steps.length ? validar({ steps }) : []), [steps]);
  const alvos = useMemo(() => alvosDeRamificacao(steps), [steps]);

  async function disparar() {
    setEnviando(true);
    setResultado(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const nums = (numeros.match(/\d[\d\s().-]{9,}/g) || [])
        .map((s) => s.replace(/\D/g, "")).filter((d) => d.length >= 12);
      const res = await fetch(`${BRIDGE_URL}/campaign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "agendar-fluxo",
          name: "painel",
          channel_id: canalId,
          numbers: nums,
          flow: { steps },
          pace: paceDoFluxo(flow?.disparo),
          forcar: forcarTeste,
        }),
      });
      setResultado(await res.json());
      carregar();
    } catch (e) {
      setResultado({ error: String(e) });
    } finally {
      setEnviando(false);
    }
  }

  // ── Biblioteca de fluxos ──────────────────────────────────────────────
  // Lê via bridge GET /flows (service_role), NÃO direto no Supabase: a RLS de flow_definitions
  // exige estar em dashboard_readers, então o admin logado via leitura direta recebia lista
  // VAZIA (fluxo salvo/publicado não aparecia). O bridge lê como service_role e não depende disso.
  const carregarBiblioteca = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${BRIDGE_URL}/flows`, {
        headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      setBiblioteca(Array.isArray(body.flows) ? body.flows : []);
    } catch { setBiblioteca([]); }
  }, []);

  useEffect(() => { if (pronto) carregarBiblioteca(); }, [pronto, carregarBiblioteca]);

  async function flowsPost(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/flows`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async function carregarFluxo(id) {
    setLibMsg("");
    if (!id) { novoFluxo(); return; }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/flows?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store",
    });
    const body = await res.json().catch(() => ({}));
    const data = body.definition;
    if (!data) { setLibMsg("fluxo não encontrado"); return; }
    setFluxoId(data.id);
    setFluxoNome(data.name);
    setFluxoInfo({ status: data.status, current_version: data.current_version });
    setTexto(JSON.stringify(data.graph_json ?? { steps: [] }, null, 2));
  }

  function novoFluxo() {
    setFluxoId(null); setFluxoNome(""); setFluxoInfo(null); setLibMsg("");
  }

  async function salvarFluxo() {
    if (!fluxoNome.trim()) { setLibMsg("dê um nome ao fluxo"); return; }
    if (jsonInvalido) { setLibMsg("JSON inválido"); return; }
    setSalvandoFluxo(true);
    const r = await flowsPost({ action: "save", id: fluxoId, name: fluxoNome.trim(), graph: { steps, startId: flow?.startId } });
    setSalvandoFluxo(false);
    if (r.error) { setLibMsg(r.error); return; }
    setFluxoId(r.id); setLibMsg("rascunho salvo ✓"); carregarBiblioteca();
  }

  async function publicarFluxo() {
    if (!fluxoId) { setLibMsg("salve o fluxo antes de publicar"); return; }
    setSalvandoFluxo(true);
    const r = await flowsPost({ action: "publish", id: fluxoId });
    setSalvandoFluxo(false);
    if (r.error) { setLibMsg(r.problemas ? `inválido: ${r.problemas.length} problema(s)` : r.error); return; }
    setLibMsg(r.inalterado ? `sem mudança (v${r.version})` : `publicado v${r.version} ✓`);
    setFluxoInfo({ status: "published", current_version: r.version });
    carregarBiblioteca();
  }

  // Config de disparo — guardada em flow.disparo (viaja com o fluxo). Edita via texto (JSON).
  const disparo = (flow && flow !== "erro" ? flow.disparo : null) ?? null;
  function setDisparo(campos) {
    const base = flow && flow !== "erro" ? flow : { steps };
    const atual = base.disparo ?? DISPARO_PADRAO;
    setTexto(JSON.stringify({ ...base, disparo: { ...atual, ...campos } }, null, 2));
  }

  if (!pronto) return null;
  const podeDisparar = steps.length > 0 && problemas.length === 0 && numeros.trim() && canalId && !enviando;
  const fluxoValido = steps.length > 0 && problemas.length === 0;

  return (
    <>
      <Nav />
      <div className="shell">
        <h1 className="page-title">Fluxos conversacionais</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 22 }}>
          Manda, espera a resposta e ramifica. O desenho abaixo mostra para onde cada resposta leva.
        </p>

        {!EDITOR_V2 && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
          <div className="card" style={{ padding: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Fluxo (JSON)
            </label>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder='{"steps":[{"id":"oi","kind":"text","text":"Olá!"}]}'
              spellCheck={false}
              style={{ width: "100%", minHeight: 300, marginTop: 8, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5, padding: 12, borderRadius: 10, resize: "vertical" }}
            />
            {jsonInvalido && (
              <div className="badge badge-red" style={{ marginTop: 10 }}>JSON inválido — confira vírgulas e chaves</div>
            )}

            <div style={{ marginTop: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                Números de teste
              </label>
              <textarea
                value={numeros}
                onChange={(e) => setNumeros(e.target.value)}
                placeholder="5511999999999"
                style={{ width: "100%", minHeight: 70, marginTop: 8, fontSize: 13, padding: 10, borderRadius: 10, resize: "vertical" }}
              />
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select value={canalId} onChange={(e) => setCanalId(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, fontSize: 13 }}>
                {canais.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.phone_number}</option>)}
              </select>
              <button className="btn-mint" onClick={disparar} disabled={!podeDisparar} style={{ padding: "10px 18px", borderRadius: 10 }}>
                {enviando ? "Disparando…" : "Disparar teste"}
              </button>
            </div>

            {problemas.length > 0 && (
              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(251,93,118,.1)", border: "1px solid rgba(251,93,118,.3)" }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: "var(--red)", marginBottom: 6 }}>
                  {problemas.length} problema{problemas.length > 1 ? "s" : ""} — o disparo fica bloqueado
                </div>
                {problemas.map((p, i) => (
                  <div key={i} style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 3 }}>
                    <code style={{ color: "var(--red)" }}>{p.stepId}</code> — {p.problema}
                  </div>
                ))}
              </div>
            )}

            <ResultadoDisparo resultado={resultado} />
          </div>

          <div className="card" style={{ padding: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Desenho do fluxo
            </label>
            {!steps.length && (
              <p style={{ color: "var(--text-faint)", fontSize: 13, marginTop: 14 }}>
                Cole um fluxo ao lado para ver o caminho de cada resposta.
              </p>
            )}
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              {steps.map((s) => {
                const meta = KINDS.find((k) => k.k === s.kind) ?? KINDS[0];
                const saidas = saidasDe(steps, s);
                const inicioDeRamo = alvos.has(s.id);
                return (
                  <div key={s.id} style={{
                    padding: 12, borderRadius: 12,
                    background: "var(--surface-2)",
                    border: `1px solid ${inicioDeRamo ? meta.cor : "var(--border-soft)"}`,
                    borderLeft: `3px solid ${meta.cor}`,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <code style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{s.id}</code>
                      <span className="badge badge-gray" style={{ fontSize: 11 }}>{meta.label}</span>
                      {ESPERA.has(s.kind) && <span className="badge badge-amber" style={{ fontSize: 11 }}>espera resposta</span>}
                      {inicioDeRamo && <span className="badge badge-gray" style={{ fontSize: 11 }}>início de ramo</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 6, whiteSpace: "pre-wrap", lineHeight: 1.45 }}>
                      {resumo(s).slice(0, 180)}
                    </div>
                    {saidas.length > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                        {saidas.map((o, i) => (
                          <div key={i} style={{ fontSize: 11, color: "var(--text-faint)" }}>
                            <span style={{ color: o.tipo === "timeout" ? "var(--amber)" : o.tipo === "fallback" ? "var(--blue)" : "var(--text-dim)" }}>
                              {o.rotulo}
                            </span>
                            {" → "}
                            <code style={{ color: "var(--mint)" }}>{o.destino}</code>
                          </div>
                        ))}
                      </div>
                    )}
                    {!saidas.length && s.kind !== "end" && (
                      <div style={{ fontSize: 11, color: "var(--amber)", marginTop: 8 }}>
                        sem saída — o fluxo termina aqui
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}

        {EDITOR_V2 && (
          <>
            <div className="card" style={{ padding: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".06em" }}>Biblioteca</label>
              <select value={fluxoId ?? ""} onChange={(e) => carregarFluxo(e.target.value)} style={{ padding: "8px 10px", borderRadius: 10, fontSize: 13, minWidth: 180 }}>
                <option value="">— novo fluxo —</option>
                {biblioteca.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status === "published" ? ` (v${f.current_version})` : f.status === "archived" ? " (arquivado)" : " (rascunho)"}</option>)}
              </select>
              <input value={fluxoNome} onChange={(e) => setFluxoNome(e.target.value)} placeholder="Nome do fluxo" style={{ padding: "8px 10px", borderRadius: 10, fontSize: 13, flex: "1 1 160px", minWidth: 120 }} />
              <button className="btn-ghost" onClick={salvarFluxo} disabled={salvandoFluxo} style={{ padding: "8px 14px", borderRadius: 10 }}>{salvandoFluxo ? "…" : "Salvar"}</button>
              <button className="btn-mint" onClick={publicarFluxo} disabled={salvandoFluxo || !fluxoId} style={{ padding: "8px 14px", borderRadius: 10 }}>Publicar</button>
              {fluxoId && <button className="btn-ghost mini" onClick={novoFluxo}>Novo</button>}
              {fluxoInfo?.status === "published" && <span className="badge badge-green" style={{ fontSize: 11 }}>publicado v{fluxoInfo.current_version}</span>}
              {libMsg && <span style={{ fontSize: 12, color: libMsg.includes("✓") ? "var(--green)" : "var(--amber)" }}>{libMsg}</span>}
            </div>

            <div className="card" style={{ padding: 0, overflow: "hidden", marginTop: 18 }}>
              <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>Editor de fluxo</div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Arraste blocos da paleta, ligue as saídas de cada botão ao próximo bloco. Sem código.</div>
                </div>
                {problemas.length > 0
                  ? <span className="badge badge-red" style={{ fontSize: 11 }}>{problemas.length} problema{problemas.length > 1 ? "s" : ""}</span>
                  : steps.length > 0 && <span className="badge badge-green" style={{ fontSize: 11 }}>válido</span>}
              </div>
              {jsonInvalido
                ? <div style={{ padding: 16 }}><div className="badge badge-red">JSON inválido — corrija no modo avançado abaixo</div></div>
                : <FlowCanvas
                    value={{ steps, startId: flow?.startId }}
                    onChange={(f) => setTexto(JSON.stringify({ ...(flow && flow !== "erro" ? flow : {}), ...f }, null, 2))}
                    problemas={problemas}
                  />}
            </div>

            {!jsonInvalido && steps.length > 0 && (
              <div className="card" style={{ padding: 16, marginTop: 18 }}>
                <details open>
                  <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 12 }}>
                    Simular conversa
                  </summary>
                  <FlowSimulator
                    value={{ steps, startId: flow?.startId }}
                    vars={{ nome: "Maria Silva", primeiro_nome: "Maria", telefone: "5511999999999" }}
                  />
                </details>
              </div>
            )}

            {!jsonInvalido && steps.length > 0 && (() => {
              const d = disparo ?? DISPARO_PADRAO;
              const fixo = d.modo === "fixo";
              const lbl = { fontSize: 11, fontWeight: 700, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".05em", display: "block", marginBottom: 5 };
              const inp = { width: 90, fontSize: 13, padding: "7px 9px", borderRadius: 9 };
              const campo = (titulo, el) => <div><label style={lbl}>{titulo}</label>{el}</div>;
              return (
                <div className="card" style={{ padding: 16, marginTop: 18 }}>
                  <details>
                    <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                      Configuração de disparo {disparo ? "" : "(usando padrão)"}
                    </summary>
                    <p style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "12px 0 14px" }}>
                      Ritmo da campanha. O tempo <b>entre as mensagens de um mesmo contato</b> já está no fluxo (blocos de pausa) — aqui é o ritmo <b>entre contatos</b>, pra aquecer o número sem a Meta punir.
                    </p>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                      {campo("Primeiro horário", <input type="number" min={0} max={23} value={d.horaInicio} onChange={(e) => setDisparo({ horaInicio: Number(e.target.value) })} style={inp} />)}
                      {campo("Último horário", <input type="number" min={1} max={24} value={d.horaFim} onChange={(e) => setDisparo({ horaFim: Number(e.target.value) })} style={inp} />)}
                      {campo("Modo", (
                        <select value={d.modo ?? "rampa"} onChange={(e) => setDisparo({ modo: e.target.value })} style={{ ...inp, width: 150 }}>
                          <option value="rampa">Rampa (sobe por dia)</option>
                          <option value="fixo">Fixo (mesmo todo dia)</option>
                        </select>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end", marginTop: 14 }}>
                      {campo(fixo ? "Mensagens por dia" : "Começa com", <input type="number" min={1} value={d.capInicial} onChange={(e) => setDisparo({ capInicial: Number(e.target.value) })} style={inp} />)}
                      {!fixo && campo("Sobe por dia", <input type="number" min={0} value={d.capIncremento} onChange={(e) => setDisparo({ capIncremento: Number(e.target.value) })} style={inp} />)}
                      {!fixo && campo("Teto (máximo/dia)", <input type="number" min={1} value={d.capMaximo} onChange={(e) => setDisparo({ capMaximo: Number(e.target.value) })} style={inp} />)}
                    </div>
                    <div style={{ marginTop: 14, padding: "9px 12px", borderRadius: 9, background: "var(--surface-2)", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>
                      {fixo
                        ? <>Manda <b>{d.capInicial}</b> contatos por dia, das <b>{d.horaInicio}h</b> às <b>{d.horaFim}h</b>, espalhados pela janela.</>
                        : <>Dia 1: <b>{d.capInicial}</b>. Sobe <b>{d.capIncremento}</b>/dia até o teto de <b>{d.capMaximo}</b>. Das <b>{d.horaInicio}h</b> às <b>{d.horaFim}h</b>.</>}
                      {" "}O intervalo entre contatos é automático (espalha o teto do dia pela janela).
                      {forcarTeste && <> <b style={{ color: "var(--amber)" }}>Forçar está ligado — o teste ignora esta janela.</b></>}
                    </div>
                  </details>
                </div>
              );
            })()}

            <div className="card" style={{ padding: 16, marginTop: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                Testar fluxo
              </label>
              {fluxoValido && (
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "var(--green)" }}>✓ Fluxo ok — pronto para disparar</div>
              )}
              <textarea
                value={numeros}
                onChange={(e) => setNumeros(e.target.value)}
                placeholder="Números de teste — 5511999999999"
                style={{ width: "100%", minHeight: 60, marginTop: 10, fontSize: 13, padding: 10, borderRadius: 10, resize: "vertical" }}
              />
              <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select value={canalId} onChange={(e) => setCanalId(e.target.value)} style={{ padding: "9px 12px", borderRadius: 10, fontSize: 13 }}>
                  {canais.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.phone_number}</option>)}
                </select>
                <button className="btn-mint" onClick={disparar} disabled={!podeDisparar} style={{ padding: "10px 18px", borderRadius: 10 }}>
                  {enviando ? "Disparando…" : "Disparar teste"}
                </button>
                <label title="Pula a revalidação do contato (conversa aberta, msg em 30 dias). Só pra teste." style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: forcarTeste ? "var(--amber)" : "var(--text-dim)" }}>
                  <input type="checkbox" checked={forcarTeste} onChange={(e) => setForcarTeste(e.target.checked)} />
                  forçar (teste: ignora revalidação + janela)
                </label>
              </div>

              {problemas.length > 0 && (
                <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(251,93,118,.1)", border: "1px solid rgba(251,93,118,.3)" }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: "var(--red)", marginBottom: 6 }}>
                    {problemas.length} problema{problemas.length > 1 ? "s" : ""} — o disparo fica bloqueado
                  </div>
                  {problemas.map((p, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 3 }}>
                      <code style={{ color: "var(--red)" }}>{p.stepId}</code> — {p.problema}
                    </div>
                  ))}
                </div>
              )}

              <ResultadoDisparo resultado={resultado} />

              <details style={{ marginTop: 14 }}>
                <summary style={{ cursor: "pointer", fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
                  Avançado — JSON do fluxo (uso técnico)
                </summary>
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder='{"steps":[{"id":"oi","kind":"text","text":"Olá!"}]}'
                  spellCheck={false}
                  style={{ width: "100%", minHeight: 220, marginTop: 10, fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.5, padding: 12, borderRadius: 10, resize: "vertical" }}
                />
                {jsonInvalido && <div className="badge badge-red" style={{ marginTop: 10 }}>JSON inválido — confira vírgulas e chaves</div>}
              </details>
            </div>
          </>
        )}

        <div className="card" style={{ padding: 16, marginTop: 18 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Contatos dentro de um fluxo
            </label>
            <button className="btn-ghost mini" onClick={carregar}>Atualizar</button>
          </div>
          {!emAndamento.length && <p style={{ color: "var(--text-faint)", fontSize: 13 }}>Nenhum contato em fluxo.</p>}
          {emAndamento.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: i ? "1px solid var(--border-soft)" : "none", fontSize: 12, flexWrap: "wrap" }}>
              <span className={`badge ${r.status === "waiting" ? "badge-amber" : "badge-green"}`} style={{ fontSize: 11 }}>
                {r.status === "waiting" ? "aguardando" : "concluído"}
              </span>
              <code style={{ color: "var(--text)" }}>…{String(r.contact_key).slice(-4)}</code>
              <span style={{ color: "var(--text-dim)" }}>{r.campaign_id}</span>
              {r.step_id && <span style={{ color: "var(--text-faint)" }}>parou em <code style={{ color: "var(--mint)" }}>{r.step_id}</code></span>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
