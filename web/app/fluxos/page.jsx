"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

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
const ESPERA = new Set(["buttons", "list"]);

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
    }
    if (s.kind === "media" && !s.media?.url) problemas.push({ stepId: s.id, problema: "mídia sem url" });
    if (s.kind === "text" && !s.text?.trim()) problemas.push({ stepId: s.id, problema: "texto vazio" });
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
      if (ESPERA.has(atual.kind) || atual.kind === "wait" || atual.kind === "end") break;
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
    const { data: st } = await supabase.from("campaign_flow_state")
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
          action: "start-fluxo",
          name: "painel",
          channel_id: canalId,
          numbers: nums,
          flow: { steps },
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

  if (!pronto) return null;
  const podeDisparar = steps.length > 0 && problemas.length === 0 && numeros.trim() && canalId && !enviando;

  return (
    <>
      <Nav />
      <div className="shell">
        <h1 className="display" style={{ fontSize: 26, marginBottom: 6 }}>Fluxos conversacionais</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 22 }}>
          Manda, espera a resposta e ramifica. O desenho abaixo mostra para onde cada resposta leva.
        </p>

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

            {resultado && (
              <pre style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "var(--bg-deep)", border: "1px solid var(--border)", fontSize: 11, overflowX: "auto", color: resultado.error ? "var(--red)" : "var(--text-dim)" }}>
                {JSON.stringify(resultado, null, 2)}
              </pre>
            )}
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
