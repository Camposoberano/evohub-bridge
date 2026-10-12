"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BRIDGE_URL, chatwootConversationUrl, supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

const STATUS = {
  running: ["badge-green", "Rodando"],
  paused: ["badge-amber", "Pausado"],
  cancelled: ["badge-gray", "Parado"],
  replied: ["badge-gray", "Respondido"],
  completed: ["badge-green", "Concluído"],
  pending: ["badge-amber", "Pendente"],
  sent: ["badge-green", "Aceito pelo emissor"],
  failed: ["badge-red", "Falhou"],
  paused_message: ["badge-amber", "Pausada"],
};

const CHANNELS = {
  "2e49dea3-9d93-4f5f-ad54-02882956d1ed": "Facebook · campo soberano",
  "319d3aa4-26df-42bf-acbf-df440ef5981d": "Facebook · Mega Sorgo Santa Elisa",
  "93a082b0-e169-4cf8-9b1f-6e93758bf908": "Instagram · Atendimento IG",
  "1f056c55-fd58-4d55-943f-7d18c0dbc43b": "Instagram · sorgo brasileiro",
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
  const [commercial, setCommercial] = useState([]);
  const [queue, setQueue] = useState([]);
  const [filter, setFilter] = useState("todos");
  const [channelFilter, setChannelFilter] = useState("todos");
  const [lastSync, setLastSync] = useState(null);
  const [serverSummary, setServerSummary] = useState({});
  const [failureEvents, setFailureEvents] = useState([]);
  const [deliveryFailures, setDeliveryFailures] = useState([]);
  const [acting, setActing] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const response = await fetch(`${BRIDGE_URL}/funnel-ops`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setSequences(data.sequences || []);
      setCommercial(data.commercial || []);
      setQueue(data.messages || []);
      setServerSummary(data.summary || {});
      setFailureEvents(data.failures || []);
      setDeliveryFailures(data.delivery_audit?.recent_failures || []);
      setError("");
      setLastSync(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  async function operate(action, item) {
    if (action === "stop" && !confirm(`Parar definitivamente o funil da conversa #${item.chatwoot_conversation_id}?`)) return;
    const key = `${action}:${item.id}`;
    setActing(key);
    setMessage("");
    const { data: { session } } = await supabase.auth.getSession();
    const payload = action === "retry"
      ? { action, message_id: item.id }
      : { action, chatwoot_conversation_id: item.chatwoot_conversation_id };
    try {
      const response = await fetch(`${BRIDGE_URL}/funnel-ops`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setMessage(action === "pause" ? "Funil pausado." : action === "resume" ? "Funil retomado." : action === "stop" ? "Funil parado." : "Mensagem devolvida à fila.");
      await load({ silent: true });
    } catch (err) {
      setMessage(`Falha: ${err.message}`);
    } finally {
      setActing("");
    }
  }

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
      running: serverSummary.running ?? sequences.filter((item) => item.status === "running").length,
      paused: serverSummary.paused ?? sequences.filter((item) => item.status === "paused").length,
      pending: serverSummary.pending ?? scheduled.filter((item) => item.status === "pending").length,
      failed: serverSummary.failed ?? queue.filter((item) => item.status === "failed").length,
      sent: serverSummary.sent ?? queue.filter((item) => item.status === "sent").length,
      won: serverSummary.won ?? 0,
      lost: serverSummary.lost ?? 0,
      completed: serverSummary.completed ?? sequences.filter((item) => item.status === "completed").length,
      wonValue: serverSummary.won_value_cents ?? 0,
      conversion: serverSummary.conversion_rate,
    };
  }, [sequences, queue, serverSummary]);

  const visibleSequences = sequences.filter((item) =>
    (filter === "todos" || item.status === filter) &&
    (channelFilter === "todos" ||
      (channelFilter === "5895" ? !CHANNELS[item.conversation?.channel_id] : item.conversation?.channel_id === channelFilter))
  );
  const upcomingByConversation = useMemo(() => {
    const groups = new Map();
    for (const item of queue.filter((row) => ["pending", "paused"].includes(row.status))) {
      const key = `${item.chatwoot_conversation_id}:${item.status}`;
      const current = groups.get(key);
      if (!current) groups.set(key, { ...item, count: 1, types: new Set([item.type]) });
      else { current.count += 1; current.types.add(item.type); }
    }
    return [...groups.values()].sort((a, b) => new Date(a.send_at) - new Date(b.send_at)).slice(0, 100);
  }, [queue]);
  const failed = queue.filter((item) => item.status === "failed")
    .sort((a, b) => new Date(b.send_at) - new Date(a.send_at)).slice(0, 80);
  const failureByMessage = useMemo(() => {
    const map = new Map();
    for (const event of deliveryFailures) {
      const id = String(event.scheduled_message_id || "");
      if (id && !map.has(id)) map.set(id, event);
    }
    return map;
  }, [deliveryFailures]);
  const failureByConversation = useMemo(() => {
    const map = new Map();
    for (const event of failureEvents) {
      const conversation = Number(event.payload?.conv || 0);
      if (conversation && !map.has(conversation)) map.set(conversation, event);
    }
    return map;
  }, [failureEvents]);

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
        {message && <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>{message}</div>}

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <div className="stat-card"><div className="stat-label">Funis rodando</div><div className="stat-value">{summary.running}</div><div className="stat-sub">sequências ativas</div></div>
          <div className="stat-card"><div className="stat-label">Funis pausados</div><div className="stat-value">{summary.paused}</div><div className="stat-sub">aguardando retomada</div></div>
          <div className="stat-card"><div className="stat-label">Concluídos</div><div className="stat-value">{summary.completed}</div><div className="stat-sub">roteiro entregue</div></div>
          <div className="stat-card"><div className="stat-label">Na fila</div><div className="stat-value">{summary.pending}</div><div className="stat-sub">mensagens pendentes</div></div>
          <div className="stat-card"><div className="stat-label">Falhas</div><div className="stat-value">{summary.failed}</div><div className="stat-sub">exigem diagnóstico</div></div>
          <div className="stat-card"><div className="stat-label">Conversões</div><div className="stat-value">{summary.won}</div><div className="stat-sub">{summary.conversion == null ? "sem base decidida" : `${summary.conversion}% de conversão`}</div></div>
          <div className="stat-card"><div className="stat-label">Valor ganho</div><div className="stat-value" style={{ fontSize: 22 }}>{(summary.wonValue / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</div><div className="stat-sub">atribuído às conversas</div></div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div><div style={{ fontSize: 17, fontWeight: 700 }}>Sequências por conversa</div><div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 3 }}>Cada conversa deve ter no máximo um funil ativo.</div></div>
            <select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="todos">Todos os status</option><option value="running">Rodando</option><option value="paused">Pausados</option><option value="completed">Concluídos</option><option value="cancelled">Parados</option><option value="replied">Respondidos</option></select>
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
              <option value="todos">Todos os canais</option>
              <option value="5895">WhatsApp 5895 e demais</option>
              {Object.entries(CHANNELS).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table table-ops"><thead><tr><th>Funil</th><th>Cliente</th><th>Conversa</th><th>Status</th><th>Ações</th></tr></thead><tbody>
            {visibleSequences.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma sequência encontrada.</td></tr> : visibleSequences.slice(0, 100).map((item) => { const [cls, label] = badge(item.status); const contact = item.conversation?.contact; const chatUrl = chatwootConversationUrl(item.chatwoot_conversation_id); const pauseReason = item.pause_event?.payload?.reason; return <tr key={item.id}><td>{item.funnel || "—"}<div style={{ color: "var(--text-dim)", fontSize: 11 }}>{CHANNELS[item.conversation?.channel_id] || "WhatsApp/outro"}</div><div style={{ color: "var(--text-faint)", fontSize: 11 }}>Origem: {item.origin === "ad_referral" ? "anúncio" : item.origin === "commercial_fallback" ? "primeira conversa comercial" : "—"} · 1ª aceitação: {item.first_acceptance_seconds == null ? "—" : `${item.first_acceptance_seconds}s`}</div></td><td>{contact?.name || contact?.phone || contact?.external_contact_id || "—"}</td><td>#{item.chatwoot_conversation_id || "—"}</td><td><span className={`badge ${cls}`}>{label}</span>{item.status === "paused" && pauseReason && <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 4 }}>Motivo: {pauseReason}</div>}</td><td><div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{chatUrl && <Link href={chatUrl} target="_blank" className="btn-ghost mini">Abrir</Link>}{item.status === "running" && <button className="btn-ghost mini" disabled={acting === `pause:${item.id}`} onClick={() => operate("pause", item)}>Pausar</button>}{item.status === "paused" && <button className="btn-ghost mini" disabled={acting === `resume:${item.id}`} onClick={() => operate("resume", item)}>Retomar</button>}{["running", "paused"].includes(item.status) && <button className="btn-ghost mini" disabled={acting === `stop:${item.id}`} onClick={() => operate("stop", item)} style={{ color: "var(--red)" }}>Parar</button>}</div></td></tr>; })}
          </tbody></table></div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Sequências comerciais enviadas</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>Preço, plantio, nutrição e vídeos disparados nas últimas 48 horas.</div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table table-ops"><thead><tr><th>Tipo</th><th>Cliente</th><th>Conversa</th><th>Último envio</th><th>Registros</th><th>Ação</th></tr></thead><tbody>
            {commercial.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma sequência comercial registrada.</td></tr> : commercial.slice(0, 100).map((item) => { const contact = item.conversation?.contact; const chatUrl = chatwootConversationUrl(item.chatwoot_conversation_id); return <tr key={`${item.conversation_id}:${item.intent}`}><td>{item.intent}</td><td>{contact?.name || contact?.phone || contact?.external_contact_id || "—"}</td><td>#{item.chatwoot_conversation_id || "—"}</td><td>{when(item.sent_at)}</td><td>{item.count || 1}</td><td>{chatUrl && <Link href={chatUrl} target="_blank" className="btn-ghost mini">Abrir</Link>}</td></tr>; })}
          </tbody></table></div>
        </div>

        <div className="card">
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Próximos disparos</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>Um resumo por conversa. O horário indica o próximo envio e a quantidade mostra todas as peças aguardando.</div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table table-ops"><thead><tr><th>Próximo</th><th>Conversa</th><th>Dia</th><th>Peças aguardando</th><th>Tipos</th><th>Status</th></tr></thead><tbody>
            {upcomingByConversation.length === 0 ? <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma mensagem pendente.</td></tr> : upcomingByConversation.map((item) => { const [cls, label] = badge(item.status); return <tr key={`${item.chatwoot_conversation_id}:${item.status}`}><td>{when(item.send_at)}</td><td>#{item.chatwoot_conversation_id || "—"}</td><td>{item.day ?? "—"}</td><td>{item.count}</td><td>{[...item.types].join(", ")}</td><td><span className={`badge ${cls}`}>{label}</span></td></tr>; })}
          </tbody></table></div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Falhas para revisar</div>
          <div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>Envio incerto exige conferência do recibo do provedor. Reprocessar só aparece para rejeição 429 confirmada.</div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table table-ops"><thead><tr><th>Conversa</th><th>Etapa</th><th>Tipo</th><th>Motivo mais recente</th><th>Ação</th></tr></thead><tbody>{failed.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma falha pendente.</td></tr> : failed.map((item) => { const audit = failureByMessage.get(String(item.id)); const legacy = failureByConversation.get(Number(item.chatwoot_conversation_id)); const delivery = item.delivery || {}; const outcome = delivery.last_outcome || audit?.outcome; const stage = delivery.transport_stage || audit?.transport_stage; const elapsed = delivery.transport_elapsed_ms || audit?.transport_elapsed_ms; const pendingVideo = item.type === "video" && outcome === "uncertain" && stage === "await_receipt"; const waitMinutes = delivery.last_attempt_at ? Math.max(0, Math.floor((Date.now() - Date.parse(delivery.last_attempt_at)) / 60000)) : null; const reason = pendingVideo ? `Vídeo com entrega sem confirmação há ${waitMinutes ?? "?"} min. Conferir recibo antes de qualquer reenvio.` : outcome === "uncertain" ? `Envio incerto na uazapi${stage ? ` · ${stage}` : ""}${elapsed ? ` · ${Math.round(elapsed / 1000)}s` : ""}. Conferir recibo antes de reenviar.` : outcome === "rejected" ? `Provedor rejeitou o envio${delivery.provider_status ? ` · HTTP ${delivery.provider_status}` : ""}.` : audit?.failure_stage ? `Falha em ${audit.failure_stage}.` : legacy?.payload?.error || "Falha sem diagnóstico completo; conferir histórico."; const chatUrl = chatwootConversationUrl(item.chatwoot_conversation_id); return <tr key={item.id}><td>#{item.chatwoot_conversation_id || "—"}</td><td>{item.day ?? "—"} / {item.step ?? "—"}</td><td>{item.type || "—"}</td><td style={{ maxWidth: 420, color: "var(--red)" }} title={reason}>{reason}<div style={{ color: "var(--text-faint)", fontSize: 11 }}>{when(audit?.received_at || item.send_at)}</div></td><td>{delivery.retryable === true ? <button className="btn-ghost mini" disabled={acting === `retry:${item.id}`} onClick={() => operate("retry", item)}>{acting === `retry:${item.id}` ? "Reprocessando..." : "Reprocessar"}</button> : chatUrl ? <Link href={chatUrl} target="_blank" className="btn-ghost mini">Conferir conversa</Link> : <span>Revisão manual</span>}</td></tr>; })}</tbody></table></div>
        </div>
      </main>
    </>
  );
}
