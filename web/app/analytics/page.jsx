"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

const DAY = 86_400_000;

function brl(cents) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function dur(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
function dayKey(iso) {
  return (iso || "").slice(0, 10);
}

export default function Analytics() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [dias, setDias] = useState(7);
  const [canalId, setCanalId] = useState("todos");
  const [canais, setCanais] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [contatos, setContatos] = useState([]);
  const [convs, setConvs] = useState([]);
  const [mortos, setMortos] = useState([]);

  const carregar = useCallback(async (d) => {
    const desde = new Date(Date.now() - d * DAY).toISOString();
    const [ch, ms, ct, cv, dead] = await Promise.all([
      supabase.from("channels").select("id,name,type"),
      supabase.from("messages").select("channel_id,direction,status,sent_at,created_at").gte("created_at", desde),
      supabase.from("contacts").select("channel_id,first_seen_at").gte("first_seen_at", desde),
      supabase.from("conversations").select("channel_id,opened_at,first_response_at,resolved_at,outcome,outcome_value_cents,outcome_set_at"),
      supabase.from("contacts").select("channel_id,attributes").eq("attributes->>dead", "true"),
    ]);
    setCanais(ch.data || []);
    setMsgs(ms.data || []);
    setContatos(ct.data || []);
    setConvs(cv.data || []);
    setMortos(dead.data || []);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar(dias);
    });
  }, [router, carregar, dias]);

  const f = useCallback((rows) => canalId === "todos" ? rows : rows.filter((r) => r.channel_id === canalId), [canalId]);

  const stats = useMemo(() => {
    const desdeMs = Date.now() - dias * DAY;
    const m = f(msgs), c = f(contatos), v = f(convs);
    const msgsIn = m.filter((x) => x.direction === "in").length;
    const msgsOut = m.filter((x) => x.direction === "out").length;
    const opened = v.filter((x) => Date.parse(x.opened_at) >= desdeMs).length;
    const resolved = v.filter((x) => x.resolved_at && Date.parse(x.resolved_at) >= desdeMs).length;
    // tempo de 1ª resposta médio
    const responded = v.filter((x) => x.first_response_at && x.opened_at);
    const avgFirst = responded.length
      ? responded.reduce((s, x) => s + (Date.parse(x.first_response_at) - Date.parse(x.opened_at)) / 1000, 0) / responded.length
      : null;
    // comercial (no período, por outcome_set_at)
    const setInPeriod = v.filter((x) => x.outcome_set_at && Date.parse(x.outcome_set_at) >= desdeMs);
    const won = setInPeriod.filter((x) => x.outcome === "won");
    const lost = setInPeriod.filter((x) => x.outcome === "lost");
    const wonValue = won.reduce((s, x) => s + (x.outcome_value_cents || 0), 0);
    const decided = won.length + lost.length;
    const conv = decided ? Math.round((won.length / decided) * 100) : null;
    return { msgsIn, msgsOut, newContacts: c.length, opened, resolved, avgFirst, won: won.length, lost: lost.length, wonValue, conv };
  }, [msgs, contatos, convs, f, dias]);

  const serie = useMemo(() => {
    const m = f(msgs);
    const buckets = {};
    for (let i = dias - 1; i >= 0; i--) {
      const k = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
      buckets[k] = { in: 0, out: 0 };
    }
    for (const x of m) {
      const k = dayKey(x.sent_at || x.created_at);
      if (buckets[k]) buckets[k][x.direction === "in" ? "in" : "out"]++;
    }
    return Object.entries(buckets).map(([k, v]) => ({ day: k, ...v }));
  }, [msgs, f, dias]);

  const maxBar = Math.max(1, ...serie.map((s) => s.in + s.out));

  // Funil de entrega (saída) por status + números mortos.
  const entrega = useMemo(() => {
    const out = f(msgs).filter((x) => x.direction === "out");
    const c = (s) => out.filter((x) => x.status === s).length;
    return {
      enviadas: out.length,
      entregues: c("delivered") + c("read"),
      lidas: c("read"),
      falhas: c("failed"),
    };
  }, [msgs, f]);
  const numerosMortos = useMemo(() => (canalId === "todos" ? mortos : mortos.filter((m) => m.channel_id === canalId)).length, [mortos, canalId]);

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
          <div>
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Analytics</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Operacional e comercial</div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <select value={canalId} onChange={(e) => setCanalId(e.target.value)}>
              <option value="todos">Todos os canais</option>
              {canais.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <div className="tabs" style={{ margin: 0 }}>
              {[7, 30, 90].map((d) => (
                <button key={d} className={"tab" + (dias === d ? " tab-active" : "")} onClick={() => setDias(d)}>{d}d</button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".03em" }}>Operacional</div>
        <div className="stat-grid" style={{ marginBottom: 26 }}>
          <Stat label="Mensagens recebidas" value={stats.msgsIn} />
          <Stat label="Mensagens enviadas" value={stats.msgsOut} />
          <Stat label="Novos contatos" value={stats.newContacts} />
          <Stat label="Conversas abertas" value={stats.opened} />
          <Stat label="Conversas resolvidas" value={stats.resolved} />
          <Stat label="1ª resposta (média)" value={dur(stats.avgFirst)} />
        </div>

        <div className="card" style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Volume de mensagens / dia</div>
          <div className="bars">
            {serie.map((s) => (
              <div key={s.day} className="bar-col" title={`${s.day}: ${s.in} recebidas, ${s.out} enviadas`}>
                <div className="bar-stack" style={{ height: `${((s.in + s.out) / maxBar) * 100}%` }}>
                  <div className="bar-seg-in" style={{ height: `${(s.in / Math.max(1, s.in + s.out)) * 100}%` }} />
                  <div className="bar-seg-out" style={{ height: `${(s.out / Math.max(1, s.in + s.out)) * 100}%` }} />
                </div>
                {dias <= 30 && <div className="bar-label">{s.day.slice(5)}</div>}
              </div>
            ))}
          </div>
          <div className="legend">
            <span><span className="legend-dot" style={{ background: "var(--blue)" }} />Recebidas</span>
            <span><span className="legend-dot" style={{ background: "var(--mint)" }} />Enviadas</span>
          </div>
        </div>

        <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".03em" }}>Entrega (saída)</div>
        <div className="stat-grid" style={{ marginBottom: 8 }}>
          <Stat label="Enviadas" value={entrega.enviadas} />
          <Stat label="Entregues" value={entrega.entregues} sub={entrega.enviadas ? `${Math.round(entrega.entregues / entrega.enviadas * 100)}%` : null} />
          <Stat label="Lidas" value={entrega.lidas} sub={entrega.enviadas ? `${Math.round(entrega.lidas / entrega.enviadas * 100)}%` : null} />
          <Stat label="Falhas" value={entrega.falhas} />
          <Stat label="Números mortos" value={numerosMortos} sub="inexistentes / inválidos" />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 24 }}>
          Status vem da Meta (entregue/lido). Número morto = envio falhou por inexistente — some das campanhas.
        </div>

        <div style={{ fontSize: 13, color: "var(--text-faint)", marginBottom: 10, textTransform: "uppercase", letterSpacing: ".03em" }}>Comercial</div>
        <div className="stat-grid">
          <Stat label="Ganhos" value={stats.won} sub={stats.conv != null ? `${stats.conv}% conversão` : null} />
          <Stat label="Perdidos" value={stats.lost} />
          <Stat label="Valor ganho" value={brl(stats.wonValue)} />
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 14 }}>
          Marque ganho/perdido na aba <b>Conversas</b>. Os números comerciais contam o que foi decidido no período.
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
