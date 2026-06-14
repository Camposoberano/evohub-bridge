"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

const ABAS = ["verificar", "bloqueios", "etiquetas", "contatos"];

export default function Ferramentas() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [insts, setInsts] = useState([]);
  const [inst, setInst] = useState("");
  const [aba, setAba] = useState("verificar");
  const [msg, setMsg] = useState("");
  const [out, setOut] = useState(null);
  const [input, setInput] = useState("");

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
    setInsts(conn);
    if (conn[0]) setInst(conn[0].name);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  function nums() { return (input.match(/\d[\d\s().-]{9,}/g) || []).map((s) => s.replace(/\D/g, "")).filter((d) => d.length >= 12); }

  async function run(fn) { if (!inst) return setMsg("Escolha uma instância conectada."); setMsg("…"); setOut(null); await fn(); }
  async function verificar() { run(async () => { const r = await api("check", { numbers: nums() }); setOut(r.data); setMsg(`Checados ${nums().length}.`); }); }
  async function bloquear(b) { run(async () => { const r = await api("block", { number: nums()[0], block: b }); setMsg(r.ok ? (b ? "Bloqueado." : "Desbloqueado.") : "Erro"); }); }
  async function verBloqueados() { run(async () => { const r = await api("blocklist"); setOut(r.data); setMsg(""); }); }
  async function verEtiquetas() { run(async () => { const r = await api("labels"); setOut(r.data); setMsg(""); }); }
  async function criarEtiqueta() { const name = prompt("Nome da etiqueta:"); if (!name) return; run(async () => { const r = await api("label_edit", { label: { name, action: "add" } }); setMsg(r.ok ? "Criada." : "Erro: " + JSON.stringify(r.data).slice(0, 120)); verEtiquetas(); }); }
  async function verContatos() { run(async () => { const r = await api("contacts"); setOut(r.data); setMsg(""); }); }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 16 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Ferramentas WhatsApp</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Verificar número, bloqueios, etiquetas e contatos por instância</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
          <select value={inst} onChange={(e) => setInst(e.target.value)}>
            <option value="">Instância…</option>
            {insts.map((i) => <option key={i.name} value={i.name}>{i.name} — {i.number}</option>)}
          </select>
          <div className="tabs" style={{ margin: 0 }}>
            {ABAS.map((a) => <button key={a} className={"tab" + (aba === a ? " tab-active" : "")} onClick={() => { setAba(a); setOut(null); setMsg(""); }}>{a}</button>)}
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 12, fontSize: 13 }}>{msg}</div>}

        <div className="card">
          {aba === "verificar" && (
            <>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Números (um por linha) — vê quais existem no WhatsApp</label>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} placeholder={"5511999999999"} style={{ width: "100%", margin: "6px 0 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
              <button className="btn-mint" onClick={verificar}>Verificar {nums().length} números</button>
            </>
          )}
          {aba === "bloqueios" && (
            <>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Número</label>
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="5511999999999" style={{ width: "100%", margin: "6px 0 10px" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn-ghost" onClick={() => bloquear(true)}>Bloquear</button>
                <button className="btn-ghost" onClick={() => bloquear(false)}>Desbloquear</button>
                <button className="btn-ghost" onClick={verBloqueados}>Ver bloqueados</button>
              </div>
            </>
          )}
          {aba === "etiquetas" && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-ghost" onClick={verEtiquetas}>Listar etiquetas</button>
              <button className="btn-mint" onClick={criarEtiqueta}>+ Nova etiqueta</button>
            </div>
          )}
          {aba === "contatos" && (
            <button className="btn-ghost" onClick={verContatos}>Puxar contatos da agenda</button>
          )}

          {out && (
            <pre style={{ marginTop: 14, fontSize: 12, color: "var(--text-dim)", whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto", background: "var(--surface-2)", padding: 12, borderRadius: 8 }}>
              {JSON.stringify(out, null, 2).slice(0, 4000)}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}
