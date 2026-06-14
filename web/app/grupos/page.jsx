"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

export default function Grupos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [insts, setInsts] = useState([]);
  const [inst, setInst] = useState("");
  const [aba, setAba] = useState("grupos");
  const [grupos, setGrupos] = useState(null);
  const [canais, setCanais] = useState(null);
  const [msg, setMsg] = useState("");

  async function api(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/uazapi`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, instance: inst, ...params }) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  const carregar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/uazapi`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action: "instances" }) });
    const j = await res.json().catch(() => ({}));
    const conn = (j.instances || []).filter((i) => i.status === "connected");
    setInsts(conn); if (conn[0]) setInst(conn[0].name);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  function arr(d) { return Array.isArray(d) ? d : (d?.groups || d?.list || d?.data || []); }

  async function listarGrupos() { if (!inst) return setMsg("Escolha instância."); setMsg("…"); const r = await api("groups_list"); setGrupos(arr(r.data)); setMsg(r.ok ? "" : "Erro: " + JSON.stringify(r.data).slice(0, 120)); }
  async function listarCanais() { if (!inst) return setMsg("Escolha instância."); setMsg("…"); const r = await api("newsletters_list"); setCanais(arr(r.data)); setMsg(r.ok ? "" : "Erro: " + JSON.stringify(r.data).slice(0, 120)); }
  async function criarGrupo() {
    const name = prompt("Nome do grupo:"); if (!name) return;
    const parts = prompt("Participantes (números separados por vírgula):", "") || "";
    const participants = parts.split(",").map((s) => s.replace(/\D/g, "")).filter((d) => d.length >= 12);
    setMsg("Criando…"); const r = await api("group_create", { name, participants });
    setMsg(r.ok ? "Grupo criado." : "Erro: " + JSON.stringify(r.data).slice(0, 150)); listarGrupos();
  }
  async function criarCanal() {
    const name = prompt("Nome do canal:"); if (!name) return;
    const description = prompt("Descrição (opcional):", "") || "";
    setMsg("Criando…"); const r = await api("newsletter_create", { name, description });
    setMsg(r.ok ? "Canal criado." : "Erro: " + JSON.stringify(r.data).slice(0, 150)); listarCanais();
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  const lista = aba === "grupos" ? grupos : canais;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Grupos & Canais</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Gerenciar grupos e canais (newsletters) por instância</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <select value={inst} onChange={(e) => setInst(e.target.value)}>
            <option value="">Instância…</option>
            {insts.map((i) => <option key={i.name} value={i.name}>{i.name} — {i.number}</option>)}
          </select>
          <div className="tabs" style={{ margin: 0 }}>
            <button className={"tab" + (aba === "grupos" ? " tab-active" : "")} onClick={() => setAba("grupos")}>Grupos</button>
            <button className={"tab" + (aba === "canais" ? " tab-active" : "")} onClick={() => setAba("canais")}>Canais</button>
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>{msg}</div>}

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {aba === "grupos" ? (
            <>
              <button className="btn-ghost" onClick={listarGrupos}>Listar grupos</button>
              <button className="btn-mint" onClick={criarGrupo}>+ Novo grupo</button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={listarCanais}>Listar canais</button>
              <button className="btn-mint" onClick={criarCanal}>+ Novo canal</button>
            </>
          )}
        </div>

        <div className="table-wrap">
          {lista == null ? <div style={{ padding: 16, color: "var(--text-dim)" }}>Clique em listar.</div> :
            lista.length === 0 ? <div style={{ padding: 16, color: "var(--text-dim)" }}>Nenhum.</div> :
              lista.map((g, i) => (
                <div key={g.id || g.jid || g.JID || i} className="integ">
                  <div className="integ-body">
                    <div className="integ-name">{g.name || g.subject || g.Name || "—"}</div>
                    <div className="integ-desc">{g.participants?.length ? `${g.participants.length} membros` : (g.jid || g.JID || "")}</div>
                  </div>
                </div>
              ))}
        </div>
      </div>
    </>
  );
}
