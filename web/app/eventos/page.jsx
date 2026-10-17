"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

const FONTES = ["todos", "uazapi", "hub", "chatwoot", "sync-facebook"];

function quando(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Eventos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [eventos, setEventos] = useState([]);
  const [fonte, setFonte] = useState("uazapi");
  const [dias, setDias] = useState(7);
  const [auto, setAuto] = useState(true);
  const [msg, setMsg] = useState("");
  const [instancias, setInstancias] = useState([]);
  const [entradas, setEntradas] = useState(null);
  const [erroEntradas, setErroEntradas] = useState("");
  const [recuperando, setRecuperando] = useState("");

  const carregarEntradas = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${BRIDGE_URL}/inbound-incidents`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (!res.ok) throw new Error("O diagnóstico de entradas está indisponível");
      setEntradas(await res.json());
      setErroEntradas("");
    } catch (error) {
      setErroEntradas(error.message || "Falha ao consultar entradas");
    }
  }, []);

  async function recuperarEntrada(incident) {
    setRecuperando(incident.event_id);
    setMsg("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BRIDGE_URL}/inbound-incidents`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ event_id: incident.event_id }),
      });
      const data = await res.json();
      setMsg(res.ok
        ? "Entrada reprocessada. Confira a conversa para confirmar a resposta ao cliente."
        : data.error || "A recuperação não foi concluída.");
      await carregarEntradas();
    } catch {
      setMsg("A recuperação não foi concluída. Tente novamente pelo painel.");
    } finally {
      setRecuperando("");
    }
  }

  const carregar = useCallback(async (f, d) => {
    const desde = new Date(Date.now() - d * 86_400_000).toISOString();
    let q = supabase.from("events").select("id,source,event_type,received_at,occurred_at,payload")
      .gte("received_at", desde).order("received_at", { ascending: false }).limit(200);
    if (f !== "todos") q = q.eq("source", f);
    const { data } = await q;
    setEventos(data || []);
  }, []);

  async function api(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/uazapi`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar(fonte, dias);
      carregarEntradas();
      api("instances").then((r) => { if (r.ok) setInstancias(r.data.instances || []); });
    });
  }, [router, carregar, carregarEntradas, fonte, dias]);

  useEffect(() => {
    if (!pronto) return;
    const t = setInterval(carregarEntradas, 30_000);
    return () => clearInterval(t);
  }, [pronto, carregarEntradas]);

  useEffect(() => {
    if (!auto || !pronto) return;
    const t = setInterval(() => carregar(fonte, dias), 5000);
    return () => clearInterval(t);
  }, [auto, pronto, fonte, dias, carregar]);

  async function ligarWebhook() {
    const conectadas = instancias.filter((i) => i.status === "connected");
    if (conectadas.length === 0) return setMsg("Nenhuma instância conectada.");
    setMsg("Ligando webhook…");
    let ok = 0;
    for (const i of conectadas) { const r = await api("set_webhook", { instance: i.name }); if (r.ok) ok++; }
    setMsg(`Webhook ligado em ${ok}/${conectadas.length} instâncias. Eventos vão começar a chegar (precisa o bridge público).`);
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Monitor de eventos</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Tudo que entra/sai em tempo real (webhooks)</div>
          </div>
          <button className="btn-ghost" onClick={ligarWebhook}>Ligar webhook uazapi</button>
        </div>

        {msg && <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>{msg}</div>}

        <section className="card" style={{ marginBottom: 22, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Entradas de clientes</div>
              <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 4 }}>
                Webhook recebido → mensagem registrada → clique iniciado. Últimos 3 dias.
              </div>
            </div>
            <button className="btn-ghost" onClick={carregarEntradas}>Atualizar diagnóstico</button>
          </div>
          {erroEntradas && <div style={{ color: "var(--danger, #dc3545)", marginTop: 12 }}>{erroEntradas}</div>}
          {!entradas && !erroEntradas && <div style={{ color: "var(--text-dim)", fontSize: 13, marginTop: 14 }}>Carregando diagnóstico…</div>}
          {entradas && <>
            <div style={{ color: "var(--text-dim)", fontSize: 12, marginTop: 10 }}>Conferido em {quando(entradas.checked_at)}</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "18px 0" }}>
              <div><strong style={{ fontSize: 22 }}>{entradas.scanned}</strong><div style={{ fontSize: 12, color: "var(--text-dim)" }}>entradas recebidas</div></div>
              <div><strong style={{ fontSize: 22, color: entradas.incidents.length ? "#d97706" : "inherit" }}>{entradas.incidents.length}</strong><div style={{ fontSize: 12, color: "var(--text-dim)" }}>pendentes</div></div>
              <div><strong style={{ fontSize: 22 }}>{entradas.late}</strong><div style={{ fontSize: 12, color: "var(--text-dim)" }}>registradas com atraso</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Precisam de atenção</div>
            {entradas.incidents.length === 0
              ? <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 16 }}>Nenhuma entrada pendente encontrada.</div>
              : <div className="table-wrap" style={{ marginBottom: 18 }}><table className="table"><thead><tr><th>Quando</th><th>Conversa</th><th>Etapa</th><th>Motivo</th><th>Ação</th></tr></thead><tbody>
                {entradas.incidents.map((item) => <tr key={item.event_id}>
                  <td style={{ whiteSpace: "nowrap" }}>{quando(item.received_at)}</td>
                  <td><strong>{item.channel}</strong> · {item.contact_suffix}{item.choice && <div style={{ fontSize: 12 }}>{item.choice}</div>}</td>
                  <td>{item.state === "missing_message" ? "Mensagem" : item.state === "missing_channel" ? "Canal" : "Clique"}</td>
                  <td style={{ maxWidth: 360, fontSize: 13 }}>{item.reason}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {item.chatwoot_url && <a href={item.chatwoot_url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 10 }}>Abrir conversa</a>}
                    {item.can_retry && <button className="btn-ghost" disabled={Boolean(recuperando)} onClick={() => recuperarEntrada(item)}>{recuperando === item.event_id ? "Recuperando…" : "Reprocessar"}</button>}
                  </td>
                </tr>)}
              </tbody></table></div>}
            {entradas.delayed?.length > 0 && <details>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700 }}>Resolvidas com atraso ({entradas.delayed.length})</summary>
              <div className="table-wrap" style={{ marginTop: 10 }}><table className="table"><thead><tr><th>Quando</th><th>Conversa</th><th>Atraso</th><th></th></tr></thead><tbody>
                {entradas.delayed.map((item) => <tr key={item.event_id}>
                  <td>{quando(item.received_at)}</td><td>{item.channel} · {item.contact_suffix}</td>
                  <td>{item.delay_minutes} min</td>
                  <td>{item.chatwoot_url && <a href={item.chatwoot_url} target="_blank" rel="noopener noreferrer">Abrir conversa</a>}</td>
                </tr>)}
              </tbody></table></div>
            </details>}
          </>}
        </section>

        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          {FONTES.map((f) => <button key={f} className={"tab" + (fonte === f ? " tab-active" : "")} onClick={() => setFonte(f)}>{f}</button>)}
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={1}>Últimas 24h</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
          </select>
          <label style={{ fontSize: 13, color: "var(--text-dim)", marginLeft: 8 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto (5s)
          </label>
          <span className="badge badge-gray">{eventos.length}</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Hora</th><th>Fonte</th><th>Evento</th><th>Resumo</th></tr></thead>
            <tbody>
              {eventos.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-dim)", padding: 30 }}>Nenhum evento{fonte === "uazapi" ? " (ligue o webhook + bridge público)" : ""}.</td></tr>
              ) : eventos.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{quando(e.received_at || e.occurred_at)}</td>
                  <td><span className="badge badge-gray">{e.source}</span></td>
                  <td style={{ fontSize: 13 }}>{e.event_type}</td>
                  <td style={{ fontSize: 12, color: "var(--text-faint)", maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {JSON.stringify(e.payload).slice(0, 160)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
