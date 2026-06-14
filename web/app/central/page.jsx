"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL, CHATWOOT_URL, CHATWOOT_ACCOUNT_ID } from "@/lib/supabase";
import Nav from "@/components/Nav";

// Telas (Chatwoots). Por enquanto só o nosso; estrutura pronta p/ adicionar outros
// (outras contas no mesmo URL ou outro URL/cliente) quando tiver token.
const CONTAS = [
  { id: CHATWOOT_ACCOUNT_ID, label: "Campo Soberano", url: CHATWOOT_URL, accountId: CHATWOOT_ACCOUNT_ID, ativa: true },
  // exemplo futuro: { id:"1", label:"Cliente X", url: CHATWOOT_URL, accountId:"1", ativa:false },
];

const PLAT = {
  whatsapp: { label: "WhatsApp oficial", color: "#1fbf75" },
  facebook: { label: "Facebook", color: "#3b82f6" },
  instagram: { label: "Instagram", color: "#d4537e" },
};

function statusBadge(s) {
  if (s === "active" || s === "connected") return ["badge-green", "Conectado"];
  if (s === "pending") return ["badge-amber", "Pendente"];
  if (s === "error") return ["badge-red", "Erro"];
  return ["badge-gray", s || "Inativo"];
}

export default function Central() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [canais, setCanais] = useState([]);
  const [uaz, setUaz] = useState([]);
  const [add, setAdd] = useState(false);
  const [msg, setMsg] = useState("");
  const [assign, setAssign] = useState({}); // { instanceName: contaId } — atribuição manual (localStorage)

  useEffect(() => { try { setAssign(JSON.parse(localStorage.getItem("inst_tela") || "{}")); } catch (_) {} }, []);
  function atribuir(nome, contaId) {
    const novo = { ...assign, [nome]: contaId };
    setAssign(novo);
    try { localStorage.setItem("inst_tela", JSON.stringify(novo)); } catch (_) {}
  }

  async function api(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/uazapi`, {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  const carregar = useCallback(async () => {
    const ch = await supabase.from("channels").select("*").order("created_at", { ascending: false });
    setCanais(ch.data || []);
    const r = await api("instances");
    if (r.ok && r.data.instances) setUaz(r.data.instances);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  async function novoOficial(type) {
    const nome = prompt(`Nome do canal ${type}:`); if (!nome) return;
    setMsg("Criando canal…");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/connect-channel`, {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type, name: nome }),
    });
    const j = await res.json();
    if (!res.ok) { setMsg(j.error || "Erro"); return; }
    const token = (j.connect_url || "").split("/").pop();
    window.open(j.connect_url, "_blank", "noopener");
    setMsg("Canal criado — autorize na Meta na nova aba.");
    setAdd(false); carregar();
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Central de Conexões</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Cada tela = um Chatwoot. Adicione canais por tela (oficial ou não-oficial).
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>{msg}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
          {CONTAS.map((conta) => {
            const chs = conta.ativa ? canais : [];
            const uazChs = conta.ativa ? uaz.filter((i) => assign[i.name] === conta.id) : [];
            return (
              <div key={conta.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-2)" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{conta.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>conta {conta.accountId}</div>
                  </div>
                  {!conta.ativa && <span className="badge badge-gray">a configurar</span>}
                </div>

                <div style={{ padding: 14 }}>
                  {chs.length === 0 && uazChs.length === 0 ? (
                    <div style={{ color: "var(--text-faint)", fontSize: 13, padding: "8px 0" }}>Sem canais ainda.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {chs.map((c) => {
                        const plat = PLAT[c.type] || { label: c.type, color: "#888" };
                        const [cls, txt] = statusBadge(c.status);
                        return (
                          <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: plat.color }} />
                            <span style={{ flex: 1, fontSize: 14 }}>{c.name} <span style={{ color: "var(--text-faint)", fontSize: 12 }}>· {plat.label}</span></span>
                            <span className={"badge " + cls}>{txt}</span>
                          </div>
                        );
                      })}
                      {uazChs.map((i) => {
                        const [cls, txt] = statusBadge(i.status);
                        return (
                          <div key={i.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#25d366" }} />
                            <span style={{ flex: 1, fontSize: 14 }}>{i.name} <span style={{ color: "var(--text-faint)", fontSize: 12 }}>· WhatsApp não-oficial</span></span>
                            <span className={"badge " + cls}>{txt}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {conta.ativa && (
                    <div style={{ marginTop: 14 }}>
                      {!add ? (
                        <button className="btn-ghost" style={{ width: "100%" }} onClick={() => setAdd(true)}>+ Adicionar canal</button>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button className="btn-ghost mini" onClick={() => novoOficial("facebook")}>Facebook</button>
                          <button className="btn-ghost mini" onClick={() => novoOficial("instagram")}>Instagram</button>
                          <button className="btn-ghost mini" onClick={() => novoOficial("whatsapp")}>WhatsApp oficial (EVO Hub)</button>
                          <button className="btn-ghost mini" onClick={() => router.push("/instancias")}>WhatsApp não-oficial (uazapi)</button>
                          <button className="btn-ghost mini" onClick={() => setAdd(false)}>Cancelar</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* adicionar outra tela/Chatwoot */}
          <button className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 160, color: "var(--text-faint)", borderStyle: "dashed", cursor: "pointer", background: "var(--surface)" }}
            onClick={() => alert("Pra adicionar outro Chatwoot (outra conta/URL) preciso da URL + token + account_id dele. Me passa que eu ligo — vai virar uma coluna aqui.")}>
            <div style={{ fontSize: 30, marginBottom: 6 }}>+</div>
            <div style={{ fontSize: 14, textAlign: "center" }}>Adicionar Chatwoot<br /><span style={{ fontSize: 12 }}>(outra conta/cliente)</span></div>
          </button>
        </div>

        {/* INSTÂNCIAS uazapi — todas; atribua cada uma à tela certa */}
        <div className="section-title" style={{ marginTop: 28, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>WhatsApp não-oficial (uazapi) — {uaz.length} instâncias</span>
          <button className="btn-ghost mini" onClick={() => router.push("/instancias")}>Gerenciar</button>
        </div>
        <div className="table-wrap">
          {uaz.length === 0 ? <div style={{ padding: 16, color: "var(--text-dim)" }}>Nenhuma instância.</div> :
            uaz.map((i) => {
              const [cls, txt] = statusBadge(i.status);
              return (
                <div key={i.name} className="integ">
                  <div className="integ-body"><div className="integ-name">{i.name}</div><div className="integ-desc">{i.number || "—"}</div></div>
                  <span className={"badge " + cls}>{txt}</span>
                  <select value={assign[i.name] || ""} onChange={(e) => atribuir(i.name, e.target.value)} style={{ fontSize: 12, padding: "4px 8px" }}>
                    <option value="">— tela —</option>
                    {CONTAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              );
            })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
          O uazapi não informa a qual Chatwoot cada número pertence — atribua a tela aqui. (Salvo no navegador; depois persisto no banco.)
        </div>
      </div>
    </>
  );
}
