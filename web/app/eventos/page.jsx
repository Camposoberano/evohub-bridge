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
      api("instances").then((r) => { if (r.ok) setInstancias(r.data.instances || []); });
    });
  }, [router, carregar, fonte, dias]);

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
