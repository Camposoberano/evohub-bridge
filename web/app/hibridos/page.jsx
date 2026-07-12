"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BRIDGE_URL, supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

function statusInfo(value) {
  if (value === "active" || value === "connected") return ["badge-green", "Conectado"];
  if (value === "pending") return ["badge-amber", "Pendente"];
  if (value === "error") return ["badge-red", "Erro"];
  return ["badge-gray", value || "Sem status"];
}

export default function HibridosPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [routes, setRoutes] = useState([]);
  const [instances, setInstances] = useState([]);
  const [lastSync, setLastSync] = useState(null);
  const [acting, setActing] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace("/login"); return; }
    try {
      const response = await fetch(`${BRIDGE_URL}/hybrid-ops`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setRoutes(data.routes || []);
      setInstances(data.instances || []);
      setError("");
      setLastSync(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  async function setEnabled(route, enabled) {
    if (!enabled && !confirm(`Colocar ${route.channel_name || route.phone_number} em modo somente oficial agora?`)) return;
    setActing(route.channel_id);
    setMessage("");
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const response = await fetch(`${BRIDGE_URL}/hybrid-ops`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: route.channel_id, enabled, instance: route.hybrid?.instance || route.configured?.instance || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setRoutes(data.routes || []);
      setInstances(data.instances || []);
      setMessage(enabled ? "Rota híbrida ativada e persistida." : "Modo somente oficial ativado imediatamente.");
      setLastSync(new Date());
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
      timer = setInterval(load, 30000);
    });
    return () => clearInterval(timer);
  }, [router, load]);

  const connected = useMemo(() => routes.filter((item) => item.hybrid).length, [routes]);
  if (!ready) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando...</div>;

  return (
    <>
      <Nav />
      <main className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
          <div><div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Números híbridos</div><div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 4 }}>Controle oficial ↔ rota alternativa por número, com fallback automático.</div><div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 6 }}>Leitura automática a cada 30s{lastSync ? ` · ${lastSync.toLocaleTimeString("pt-BR")}` : ""}</div></div>
          <button className="btn-ghost" onClick={load} disabled={loading}>{loading ? "Consultando..." : "Atualizar rotas"}</button>
        </div>

        {error && <div className="card" style={{ borderColor: "rgba(251,93,118,.45)", marginBottom: 14 }}><strong style={{ color: "var(--red)" }}>Falha na leitura das rotas</strong><div style={{ color: "var(--text-dim)", marginTop: 5 }}>{error}</div></div>}
        {message && <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>{message}</div>}

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          <div className="stat-card"><div className="stat-label">Canais oficiais</div><div className="stat-value">{routes.length}</div><div className="stat-sub">WhatsApp com Phone ID</div></div>
          <div className="stat-card"><div className="stat-label">Rotas híbridas</div><div className="stat-value">{connected}</div><div className="stat-sub">espelhos encontrados</div></div>
          <div className="stat-card"><div className="stat-label">Instâncias Uazapi</div><div className="stat-value">{instances.length}</div><div className="stat-sub">sem expor tokens</div></div>
          <div className="stat-card"><div className="stat-label">Fallback</div><div className="stat-value">Ativo</div><div className="stat-sub">volta para a oficial se necessário</div></div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Mapa de operação</div><div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>A rota só é considerada híbrida quando o número oficial e a instância alternativa coincidem e estão permitidos pela allowlist.</div>
          <div className="table-wrap" style={{ borderRadius: 12 }}><table className="table table-ops"><thead><tr><th>Canal oficial</th><th>Número</th><th>Status</th><th>Espelho</th><th>24h</th><th>Rota</th><th>Ação</th></tr></thead><tbody>
            {routes.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhum canal oficial encontrado.</td></tr> : routes.map((item) => { const [cls, label] = statusInfo(item.status); const active = Boolean(item.hybrid); return <tr key={item.channel_id}><td><div>{item.channel_name || "—"}</div>{item.last_error && <div style={{ color: "var(--red)", fontSize: 11, marginTop: 3, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.last_error}>{item.last_error}</div>}</td><td>{item.phone_number || item.phone_number_id || "—"}</td><td><span className={`badge ${cls}`}>{label}</span></td><td>{item.hybrid?.instance || item.configured?.instance || "—"}</td><td><span style={{ color: "var(--green)" }}>{item.metrics_24h?.success || 0} ok</span> · <span style={{ color: item.metrics_24h?.fallback ? "var(--amber)" : "var(--text-faint)" }}>{item.metrics_24h?.fallback || 0} fallbacks</span></td><td><span className={`badge ${active ? "badge-green" : item.configured?.enabled ? "badge-amber" : "badge-gray"}`}>{active ? "Híbrida ativa" : item.configured?.enabled ? "Ativa sem espelho" : "Somente oficial"}</span></td><td>{active || item.configured?.enabled ? <button className="btn-ghost mini" disabled={acting === item.channel_id} onClick={() => setEnabled(item, false)} style={{ color: "var(--red)" }}>{acting === item.channel_id ? "Aplicando..." : "Somente oficial"}</button> : <button className="btn-ghost mini" disabled={acting === item.channel_id} onClick={() => setEnabled(item, true)}>{acting === item.channel_id ? "Aplicando..." : "Ativar híbrido"}</button>}</td></tr>; })}
          </tbody></table></div>
        </div>

        <div className="card"><div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Instâncias alternativas</div><div style={{ color: "var(--text-dim)", fontSize: 13, marginBottom: 12 }}>Tokens não são exibidos. Instância desconectada não deve receber tráfego de serviço.</div><div className="table-wrap" style={{ borderRadius: 12 }}><table className="table"><thead><tr><th>Instância</th><th>Número</th><th>Status</th></tr></thead><tbody>{instances.length === 0 ? <tr><td colSpan={3} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma instância retornada.</td></tr> : instances.map((item) => { const [cls, label] = statusInfo(item.status); return <tr key={item.name}><td>{item.name || "—"}</td><td>{item.number || "—"}</td><td><span className={`badge ${cls}`}>{label}</span></td></tr>; })}</tbody></table></div></div>
      </main>
    </>
  );
}
