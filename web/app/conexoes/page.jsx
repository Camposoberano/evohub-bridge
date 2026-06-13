"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL, HUB_FRONTEND } from "@/lib/supabase";

const PLAT = {
  whatsapp: { label: "WhatsApp", color: "#1fbf75" },
  facebook: { label: "Facebook", color: "#3b82f6" },
  instagram: { label: "Instagram", color: "#d4537e" },
};

function statusBadge(s) {
  if (s === "active") return ["badge-green", "Conectado"];
  if (s === "pending") return ["badge-amber", "Pendente"];
  if (s === "error") return ["badge-red", "Erro"];
  return ["badge-gray", s === "inactive" ? "Inativo" : (s || "—")];
}

function tally(rows) {
  const m = {};
  for (const r of rows || []) m[r.channel_id] = (m[r.channel_id] || 0) + 1;
  return m;
}

export default function Conexoes() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [canais, setCanais] = useState([]);
  const [stats, setStats] = useState({ contatos: {}, conversas: {}, msgs: {} });
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState("whatsapp");
  const [criando, setCriando] = useState(false);
  const [conectandoId, setConectandoId] = useState(null);

  const carregar = useCallback(async () => {
    const [chs, ct, cv, ms] = await Promise.all([
      supabase.from("channels").select("*").order("created_at", { ascending: false }),
      supabase.from("contacts").select("channel_id"),
      supabase.from("conversations").select("channel_id"),
      supabase.from("messages").select("channel_id"),
    ]);
    setCanais(chs.data || []);
    setStats({ contatos: tally(ct.data), conversas: tally(cv.data), msgs: tally(ms.data) });
  }, []);

  useEffect(() => {
    let timer;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
      timer = setInterval(carregar, 6000);
    });
    return () => clearInterval(timer);
  }, [router, carregar]);

  async function criarCanal(e) {
    e.preventDefault();
    if (!novoNome.trim()) return;
    setCriando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BRIDGE_URL}/connect-channel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: novoTipo, name: novoNome.trim() }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error || "Erro ao criar canal"); return; }
      abrirConexao(j.connect_url);
      setModal(false);
      setNovoNome("");
      carregar();
    } catch (err) {
      alert("Falha: " + err.message);
    } finally {
      setCriando(false);
    }
  }

  async function conectarCanal(canal) {
    setConectandoId(canal.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BRIDGE_URL}/connect-channel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: canal.id }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error || "Erro ao conectar canal"); return; }
      abrirConexao(j.connect_url);
      carregar();
    } catch (err) {
      alert("Falha: " + err.message);
    } finally {
      setConectandoId(null);
    }
  }

  function abrirConexao(connectUrl) {
    const token = (connectUrl || "").split("/").pop();
    window.open(`${HUB_FRONTEND}/connect/${token}`, "_blank", "noopener");
  }

  async function sair() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  const filtrados = canais.filter((c) =>
    (c.name || "").toLowerCase().includes(busca.toLowerCase()),
  );

  return (
    <div className="shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Minhas conexões</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Gerencie suas integrações com Facebook, Instagram e WhatsApp
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" onClick={sair}>Sair</button>
          <button className="btn-mint" onClick={() => setModal(true)}>+ Novo canal</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20 }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar conexões..."
          style={{ flex: 1 }} />
        <span className="badge badge-gray">{canais.length} {canais.length === 1 ? "canal" : "canais"}</span>
      </div>

      {filtrados.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "56px 20px", color: "var(--text-dim)" }}>
          <div style={{ fontSize: 17, fontWeight: 600, color: "var(--text)" }}>Nenhum canal encontrado</div>
          <div style={{ marginTop: 6, marginBottom: 18 }}>Crie seu primeiro canal para começar</div>
          <button className="btn-mint" onClick={() => setModal(true)} style={{ margin: "0 auto" }}>+ Criar primeiro canal</button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {filtrados.map((c) => {
            const plat = PLAT[c.type] || { label: c.type, color: "#888" };
            const [cls, txt] = statusBadge(c.status);
            const ident = c.phone_number || c.display_name || c.page_id || "—";
            return (
              <div key={c.id} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: plat.color, background: plat.color + "22", padding: "3px 10px", borderRadius: 999 }}>
                    {plat.label}
                  </span>
                  <span className={"badge " + cls}>{txt}</span>
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{c.name}</div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 2 }}>{ident}</div>

                <div style={{ display: "flex", gap: 18, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                  {[["contatos", stats.contatos[c.id] || 0], ["conversas", stats.conversas[c.id] || 0], ["mensagens", stats.msgs[c.id] || 0]].map(([k, v]) => (
                    <div key={k}>
                      <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{k}</div>
                    </div>
                  ))}
                </div>

                {c.status !== "active" && (
                  <button className="btn-ghost" style={{ width: "100%", marginTop: 14 }}
                    onClick={() => conectarCanal(c)}
                    disabled={conectandoId === c.id}>
                    {conectandoId === c.id ? "Abrindo Meta..." : "Conectar Meta"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }}
          onClick={() => setModal(false)}>
          <form className="card" style={{ width: 420, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()} onSubmit={criarCanal}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>Novo canal</div>

            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Nome do canal</label>
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Ex: Atendimento SP"
              style={{ width: "100%", margin: "6px 0 14px" }} autoFocus />

            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Plataforma</label>
            <select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)} style={{ width: "100%", margin: "6px 0 20px" }}>
              <option value="whatsapp">WhatsApp</option>
              <option value="facebook">Facebook (Messenger)</option>
              <option value="instagram">Instagram</option>
            </select>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost" onClick={() => setModal(false)}>Cancelar</button>
              <button type="submit" className="btn-mint" disabled={criando}>
                {criando ? "Criando…" : "Criar e conectar"}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 14 }}>
              Vai abrir o login da Meta numa nova aba pra você autorizar.
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
