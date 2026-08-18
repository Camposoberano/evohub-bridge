"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

// Rampa padrão do disparo agendado (espelha shared/campaign-pace.ts). Serve só para mostrar
// o teto de hoje na tela — quem decide de verdade é o bridge.
const PACE = { capInicial: 50, capIncremento: 15, capMaximo: 200, horaInicio: 8, horaFim: 22 };
const DIA_MS = 24 * 60 * 60 * 1000;

function capDoDia(inicio, agora) {
  const dias = Math.floor((agora - inicio) / DIA_MS);
  if (dias < 0) return 0;
  return Math.min(PACE.capMaximo, PACE.capInicial + dias * PACE.capIncremento);
}

function pct(parte, total) {
  if (!total) return 0;
  return Math.round((parte / total) * 100);
}

function horas(ms) {
  if (!ms || ms < 0) return "—";
  const h = ms / 3600000;
  if (h < 1) return `${Math.round(ms / 60000)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} dias`;
}

function Indicador({ titulo, valor, sub, cor = "var(--text)", alerta }) {
  return (
    <div className="card" style={{ padding: 14, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em" }}>
        {titulo}
      </div>
      <div className="display" style={{ fontSize: 26, color: cor, marginTop: 6, lineHeight: 1.1 }}>{valor}</div>
      {sub && <div style={{ fontSize: 12, color: alerta ? "var(--amber)" : "var(--text-dim)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function Barra({ label, valor, total, cor }) {
  const p = pct(valor, total);
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
        <span style={{ color: "var(--text-dim)" }}>{label}</span>
        <span style={{ color: "var(--text)", fontWeight: 700 }}>{valor} <span style={{ color: "var(--text-faint)", fontWeight: 400 }}>({p}%)</span></span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--bg-deep)", overflow: "hidden" }}>
        <div style={{ width: `${p}%`, height: "100%", background: cor, borderRadius: 999, transition: "width .3s" }} />
      </div>
    </div>
  );
}

export default function Acompanhamento() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [campanhas, setCampanhas] = useState([]);
  const [campanhaId, setCampanhaId] = useState("");
  const [fila, setFila] = useState([]);
  const [estados, setEstados] = useState([]);
  const [respostas, setRespostas] = useState([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setPronto(true);
    });
  }, [router]);

  // Lista de campanhas vem da própria fila: campanha sem fila não tem o que acompanhar.
  const carregarCampanhas = useCallback(async () => {
    const { data } = await supabase.from("campaign_queue")
      .select("campaign_id,created_at").order("created_at", { ascending: false }).limit(2000);
    const vistos = new Map();
    for (const r of data ?? []) {
      if (!vistos.has(r.campaign_id)) vistos.set(r.campaign_id, r.created_at);
    }
    const lista = [...vistos.entries()].map(([id, criada]) => ({ id, criada }));
    setCampanhas(lista);
    if (lista.length && !campanhaId) setCampanhaId(lista[0].id);
  }, [campanhaId]);

  const carregarDados = useCallback(async () => {
    if (!campanhaId) return;
    setCarregando(true);
    try {
      const [q, f] = await Promise.all([
        supabase.from("campaign_queue")
          .select("contact_key,status,sent_at,attempts,last_error")
          .eq("campaign_id", campanhaId).limit(5000),
        supabase.from("campaign_flow_state")
          .select("contact_key,step_id,status,waiting_since,updated_at")
          .eq("campaign_id", campanhaId).limit(5000),
      ]);
      setFila(q.data ?? []);
      setEstados(f.data ?? []);

      // Quem respondeu: mensagem de entrada depois do disparo. Uma consulta só, pelos
      // contatos que já receberam.
      const enviados = (q.data ?? []).filter((r) => r.status === "sent");
      if (enviados.length) {
        const sufixos = enviados.map((r) => String(r.contact_key).slice(-8));
        const { data: msgs } = await supabase.from("messages")
          .select("conversation_id,sent_at,direction")
          .eq("direction", "in")
          .gte("sent_at", new Date(Date.now() - 30 * DIA_MS).toISOString())
          .limit(5000);
        setRespostas(msgs ?? []);
        void sufixos;
      } else setRespostas([]);
    } finally {
      setCarregando(false);
    }
  }, [campanhaId]);

  useEffect(() => { if (pronto) carregarCampanhas(); }, [pronto, carregarCampanhas]);
  useEffect(() => { if (pronto && campanhaId) carregarDados(); }, [pronto, campanhaId, carregarDados]);

  // Pausar/retomar/cancelar. Só afeta quem ainda NÃO recebeu — o que já saiu não volta.
  const [agindo, setAgindo] = useState("");
  const [aviso, setAviso] = useState(null);

  async function controlar(action, confirmacao) {
    if (confirmacao && !window.confirm(confirmacao)) return;
    setAgindo(action);
    setAviso(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BRIDGE_URL}/campaign`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, campaign: campanhaId }),
      });
      const r = await res.json();
      setAviso(r.error
        ? { tipo: "erro", texto: r.error }
        : { tipo: "ok", texto: `${r.afetados} contato(s) — restam ${r.pendentes} na fila, ${r.pausados} pausados` });
      await carregarDados();
    } catch (e) {
      setAviso({ tipo: "erro", texto: String(e) });
    } finally {
      setAgindo("");
    }
  }

  const m = useMemo(() => {
    const total = fila.length;
    const enviados = fila.filter((r) => r.status === "sent");
    const pendentes = fila.filter((r) => r.status === "pending").length;
    const pausados = fila.filter((r) => r.status === "paused").length;
    const falhas = fila.filter((r) => r.status === "failed");
    const pulados = fila.filter((r) => r.status === "skipped");

    // Quem respondeu = saiu de 'waiting'. O motor só move o estado quando o lead responde
    // ou o timeout vence; `done` com step nulo é fluxo concluído.
    const responderam = estados.filter((e) => e.status === "done" || (e.step_id && e.status !== "waiting"));
    const aguardando = estados.filter((e) => e.status === "waiting");

    // Onde cada um parou — o funil do fluxo.
    const porStep = {};
    for (const e of estados) {
      const k = e.step_id ?? "(concluiu)";
      porStep[k] = (porStep[k] ?? 0) + 1;
    }

    // Ritmo de hoje contra o teto da rampa.
    const inicioDia = new Date(); inicioDia.setHours(0, 0, 0, 0);
    const hoje = enviados.filter((r) => r.sent_at && new Date(r.sent_at) >= inicioDia).length;
    const criada = campanhas.find((c) => c.id === campanhaId)?.criada;
    const teto = criada ? capDoDia(new Date(criada).getTime(), Date.now()) : PACE.capInicial;

    // Tempo médio entre receber e sair da espera.
    const tempos = estados
      .filter((e) => e.waiting_since && e.updated_at && e.status !== "waiting")
      .map((e) => new Date(e.updated_at) - new Date(e.waiting_since))
      .filter((t) => t > 0 && t < 30 * DIA_MS);
    const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : 0;

    // Quanto falta, no ritmo atual.
    const restamDias = teto > 0 ? Math.ceil(pendentes / teto) : 0;

    return {
      total, enviados: enviados.length, pendentes, pausados,
      falhas: falhas.length, pulados: pulados.length,
      responderam: responderam.length, aguardando: aguardando.length,
      porStep, hoje, teto, tempoMedio, restamDias,
      motivosPulo: pulados.reduce((acc, r) => {
        const k = r.last_error || "sem motivo";
        acc[k] = (acc[k] ?? 0) + 1; return acc;
      }, {}),
      motivosFalha: falhas.reduce((acc, r) => {
        const k = (r.last_error || "sem detalhe").slice(0, 60);
        acc[k] = (acc[k] ?? 0) + 1; return acc;
      }, {}),
    };
  }, [fila, estados, campanhas, campanhaId]);

  if (!pronto) return null;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
          <div>
            <h1 className="display" style={{ fontSize: 26, marginBottom: 4 }}>Acompanhamento de campanha</h1>
            <p style={{ color: "var(--text-dim)", fontSize: 13 }}>
              Roda no servidor — não depende do seu computador estar ligado.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={campanhaId} onChange={(e) => setCampanhaId(e.target.value)}
              style={{ padding: "9px 12px", borderRadius: 10, fontSize: 13 }}>
              {campanhas.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
            <button className="btn-ghost mini" onClick={carregarDados} disabled={carregando}>
              {carregando ? "…" : "Atualizar"}
            </button>
          </div>
        </div>

        {!campanhas.length && (
          <div className="card" style={{ padding: 20, textAlign: "center", color: "var(--text-faint)" }}>
            Nenhuma campanha agendada ainda.
          </div>
        )}

        {campanhas.length > 0 && (
          <>
            <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em" }}>
                Controle
              </span>
              <button className="btn-ghost mini" disabled={!!agindo || !m.pendentes}
                onClick={() => controlar("pausar-campanha")}>
                {agindo === "pausar-campanha" ? "…" : `⏸ Pausar (${m.pendentes})`}
              </button>
              <button className="btn-ghost mini" disabled={!!agindo || !m.pausados}
                onClick={() => controlar("retomar-campanha")}>
                {agindo === "retomar-campanha" ? "…" : `▶️ Retomar (${m.pausados})`}
              </button>
              <button className="btn-ghost mini" disabled={!!agindo || (!m.pendentes && !m.pausados)}
                style={{ color: "var(--red)", borderColor: "rgba(251,93,118,.4)" }}
                onClick={() => controlar("cancelar-campanha",
                  `Cancelar o restante da campanha?\n\n${m.pendentes + m.pausados} contato(s) NÃO vão receber.\nIsso não pode ser desfeito pelo painel.`)}>
                {agindo === "cancelar-campanha" ? "…" : "✖ Cancelar o resto"}
              </button>
              <span style={{ fontSize: 12, color: "var(--text-faint)", marginLeft: "auto" }}>
                afeta só quem ainda não recebeu
              </span>
            </div>

            {aviso && (
              <div style={{
                padding: "10px 14px", borderRadius: 10, marginBottom: 14, fontSize: 13,
                background: aviso.tipo === "erro" ? "rgba(251,93,118,.1)" : "rgba(47,209,129,.1)",
                border: `1px solid ${aviso.tipo === "erro" ? "rgba(251,93,118,.3)" : "rgba(47,209,129,.3)"}`,
                color: aviso.tipo === "erro" ? "var(--red)" : "var(--green)",
              }}>
                {aviso.texto}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 12, marginBottom: 18 }}>
              <Indicador titulo="Progresso" valor={`${pct(m.enviados, m.total)}%`}
                sub={`${m.enviados} de ${m.total} contatos`} cor="var(--mint)" />
              <Indicador titulo="Hoje" valor={`${m.hoje}/${m.teto}`}
                sub={m.hoje >= m.teto ? "teto do dia atingido" : `faltam ${m.teto - m.hoje} hoje`}
                alerta={m.hoje >= m.teto} />
              <Indicador titulo="Responderam" valor={m.responderam}
                sub={`${pct(m.responderam, m.enviados)}% de quem recebeu`}
                cor={m.responderam > 0 ? "var(--green)" : "var(--text)"} />
              <Indicador titulo="Aguardando resposta" valor={m.aguardando}
                sub="no meio do fluxo" />
              <Indicador titulo="Tempo até responder" valor={horas(m.tempoMedio)}
                sub="média de quem respondeu" />
              <Indicador titulo="Falharam" valor={m.falhas}
                sub={m.falhas ? "não foi possível entregar" : "nenhuma"}
                cor={m.falhas ? "var(--red)" : "var(--text)"} alerta={m.falhas > 0} />
              <Indicador titulo="Pulados" valor={m.pulados}
                sub={m.pulados ? "excluídos na hora do envio" : "nenhum"} />
              <Indicador titulo="Restam" valor={m.pendentes}
                sub={m.restamDias ? `~${m.restamDias} dia(s) no ritmo atual` : "fila vazia"} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>
                  Situação da fila
                </div>
                <Barra label="Enviados" valor={m.enviados} total={m.total} cor="var(--green)" />
                <Barra label="Na fila" valor={m.pendentes} total={m.total} cor="var(--mint)" />
                {m.pausados > 0 && <Barra label="Pausados" valor={m.pausados} total={m.total} cor="var(--amber)" />}
                <Barra label="Pulados" valor={m.pulados} total={m.total} cor="var(--text-faint)" />
                <Barra label="Falharam" valor={m.falhas} total={m.total} cor="var(--red)" />
              </div>

              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>
                  Onde estão no fluxo
                </div>
                {!Object.keys(m.porStep).length && (
                  <p style={{ color: "var(--text-faint)", fontSize: 13 }}>Ninguém entrou no fluxo ainda.</p>
                )}
                {Object.entries(m.porStep).sort((a, b) => b[1] - a[1]).map(([step, n]) => (
                  <Barra key={step} label={step} valor={n} total={estados.length} cor="var(--blue)" />
                ))}
              </div>

              {(Object.keys(m.motivosPulo).length > 0 || Object.keys(m.motivosFalha).length > 0) && (
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>
                    Por que não entregou
                  </div>
                  {Object.entries(m.motivosPulo).map(([motivo, n]) => (
                    <div key={motivo} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span style={{ color: "var(--text-dim)" }}>{motivo}</span>
                      <span style={{ color: "var(--text)", fontWeight: 700 }}>{n}</span>
                    </div>
                  ))}
                  {Object.entries(m.motivosFalha).map(([motivo, n]) => (
                    <div key={motivo} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "5px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span style={{ color: "var(--red)" }}>{motivo}</span>
                      <span style={{ color: "var(--text)", fontWeight: 700 }}>{n}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 16, marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 12 }}>
                Contatos ({fila.length})
              </div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                {fila.slice(0, 500).map((r, i) => {
                  const est = estados.find((e) => e.contact_key === r.contact_key);
                  const cor = r.status === "sent" ? "badge-green"
                    : r.status === "failed" ? "badge-red"
                    : r.status === "skipped" ? "badge-gray" : "badge-amber";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderTop: i ? "1px solid var(--border-soft)" : "none", fontSize: 12, flexWrap: "wrap" }}>
                      <code style={{ color: "var(--text)", minWidth: 110 }}>…{String(r.contact_key).slice(-6)}</code>
                      <span className={`badge ${cor}`} style={{ fontSize: 11 }}>{r.status}</span>
                      {est?.step_id && <span style={{ color: "var(--text-faint)" }}>parou em <code style={{ color: "var(--mint)" }}>{est.step_id}</code></span>}
                      {est?.status === "done" && !est?.step_id && <span style={{ color: "var(--green)" }}>fluxo concluído</span>}
                      {r.sent_at && <span style={{ color: "var(--text-faint)", marginLeft: "auto" }}>{new Date(r.sent_at).toLocaleString("pt-BR")}</span>}
                      {r.last_error && <span style={{ color: "var(--amber)", width: "100%" }}>{r.last_error}</span>}
                    </div>
                  );
                })}
              </div>
              {fila.length > 500 && (
                <p style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 10 }}>
                  Mostrando os primeiros 500 de {fila.length}.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
