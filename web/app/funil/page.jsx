"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

const STATUS = {
  running: ["badge-green", "Rodando"],
  paused: ["badge-amber", "Pausado"],
  cancelled: ["badge-gray", "Parado"],
  replied: ["badge-gray", "Respondido"],
  pending: ["badge-amber", "Pendente"],
  sent: ["badge-green", "Enviado"],
  failed: ["badge-red", "Falhou"],
  paused_message: ["badge-amber", "Pausada"],
};

function badge(status) {
  return STATUS[status] || ["badge-gray", status || "—"];
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function FunilPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sequences, setSequences] = useState([]);
  const [queue, setQueue] = useState([]);
  const [filter, setFilter] = useState("todos");
  const [lastSync, setLastSync] = useState(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const [seq, messages] = await Promise.all([
      supabase.from("sales_sequences").select("id,conversation_id,chatwoot_conversation_id,funnel,status,created_at").order("created_at", { ascending: false }).limit(250),
      supabase.from("scheduled_messages").select("id,conversation_id,chatwoot_conversation_id,funnel,day,step,type,send_at,status,sent_at,error_message").order("send_at", { ascending: true }).limit(500),
    ]);
    const errors = [seq.error, messages.error].filter(Boolean);
    if (errors.length) setError(errors.map((item) => item.message).join(" | "));
    else setError("");
    setSequences(seq.data || []);
    setQueue(messages.data || []);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    let timer;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setReady(true);
      load();
      timer = setInterval(() => load({ silent: true }), 10000);
    });
    return () => clearInterval(timer);
  }, [router, load]);

  const summary = useMemo(() => {
    const scheduled = queue.filter((item) => ["pending", "paused"].includes(item.status));
    return {
      running: sequences.filter((item) => item.status === "running").length,
      paused: sequences.filter((item) => item.status === "paused").length,
      pending: scheduled.filter((item) => item.status === "pending").length,
      failed: queue.filter((item) => item.status === "failed").length,
    };
  }, [sequences, queue]);

  const visibleSequences = sequences.filter((item) => filter === "todos" || item.status === filter);
  const upcoming = queue.filter((item) => ["pending", "paused"].includes(item.status)).slice(0, 80);

  if (!ready) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando...</div>;

  return (
    <>
      <Nav />
      <main className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
          <div>
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Operação do funil</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 4 }}>Fila real de mensagens, próximas etapas e falhas de entrega.</div>
            <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 6 }}>Atualização automática a cada 10s{lastSync ? ` · ${lastSync.toLocaleTimeString("pt-BR")}` : ""}</div>
          </div>
          <button className="btn-ghost" onClick={() => load()} disabled={loading}>{loading ? "Atualizando..." : "Atualizar fila"}</button>
        </div>

        {error && <div className="card" style={{ borderColor: "rgba(251,93,118,.45)", marginBottom: 14 }}><strong style={{ color: "var(--red)" }}>Falha ao consultar a fila</strong><div style={{ color: "var(--text-dim)", marginTop: 5, fontSize: 13 }}>{error}</div></div>}

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <div className="stat-card"><div className="stat-label">Funis rodando</div><div className="stat-value">{summary.running}</div><div className="stat-sub">sequências ativas</div></div>
          <div className="stat-card"><div className="stat-label">Funis pausados</div><div className="stat-value">{summary.paused}</div><div className="stat-sub">aguardando retomada</div></div>
          <div className="stat-card"><div className="stat-label">Na fila</div><div className="stat-value">{summary.pending}</div><div className="stat-sub">mensagens pendentes</div></div>
          <div className="stat-card"><div className="stat-label">Falhas</div><div className="stat-value">{summary.failed}</div><div className="stat-sub">exigem diagnóstico</div></div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div><div style={{ fontSize: 17, fontWeight: 700 }}>Sequências por conversa</div><div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 3 }}>Cada conversa deve ter no máximo um funil ativo.</div></div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="todos">Todos os status</option><option value="running">Rodando</option><option value="paused">Pausados</option><option value="cancelled">Parados</option><option value="replied">Respondidos</option></select>
          </div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table"><thead><tr><th>Funil</th><th>Conversa</th><th>Status</th><th>Iniciado</th><th>Ação</th></tr></thead><tbody>
            {visibleSequences.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma sequência encontrada.</td></tr> : visibleSequences.slice(0, 100).map((item) => { const [cls, label] = badge(item.status); return <tr key={item.id}><td>{item.funnel || "—"}</td><td>#{item.chatwoot_conversation_id || "—"}</td><td><span className={`badge ${cls}`}>{label}</span></td><td>{when(item.created_at)}</td><td>{item.chatwoot_conversation_id ? <Link href={`/conversas?conversation=${item.chatwoot_conversation_id}`} className="btn-ghost mini">Abrir</Link> : "—"}</td></tr>; })}
          </tbody></table></div>
        </div>

        <div className="card">
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Próximos disparos</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>A fila abaixo é a fonte de verdade para os intervalos do funil.</div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table"><thead><tr><th>Quando</th><th>Conversa</th><th>Dia/etapa</th><th>Tipo</th><th>Status</th><th>Erro</th></tr></thead><tbody>
            {upcoming.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma mensagem pendente.</td></tr> : upcoming.map((item) => { const [cls, label] = badge(item.status); return <tr key={item.id}><td>{when(item.send_at)}</td><td>#{item.chatwoot_conversation_id || "—"}</td><td>{item.day ?? "—"} / {item.step ?? "—"}</td><td>{item.type || "—"}</td><td><span className={`badge ${cls}`}>{label}</span></td><td style={{ maxWidth: 260, color: item.error_message ? "#ff96a7" : "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.error_message || "—"}</td></tr>; })}
          </tbody></table></div>
        </div>
      </main>
    </>
  );
}
