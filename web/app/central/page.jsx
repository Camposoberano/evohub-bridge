"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL, CHATWOOT_URL, CHATWOOT_ACCOUNT_ID } from "@/lib/supabase";
import Nav from "@/components/Nav";

// Telas (Chatwoots) agora vêm do bridge (/chatwoot-accounts), editáveis no painel.
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
  const [add, setAdd] = useState(null); // conta.id cujo menu "adicionar canal" está aberto
  const [msg, setMsg] = useState("");
  const [assign, setAssign] = useState({}); // { instanceName: contaId } — persistido no banco (Supabase Storage via bridge)
  const [contas, setContas] = useState([]); // telas Chatwoot (do bridge)
  const [novaConta, setNovaConta] = useState(null); // form de adicionar Chatwoot ({label, accountId}) ou null

  // CRUD das contas Chatwoot no bridge.
  async function acc(method, body) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/chatwoot-accounts`, {
      method, headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }
  async function salvarConta(c) {
    if (!c.label?.trim() || !c.accountId?.trim()) return setMsg("Nome e account_id são obrigatórios.");
    const r = await acc("POST", {
      action: "save", label: c.label.trim(), accountId: c.accountId.trim(),
      url: c.url?.trim() || undefined, token: c.token?.trim() || undefined,
    });
    if (r.ok && r.data.accounts) { setContas(r.data.accounts); setNovaConta(null); setMsg("Chatwoot salvo."); }
    else setMsg("Erro: " + (r.data.error || "falha"));
  }
  async function renomearConta(conta) {
    const novo = prompt("Novo nome da tela:", conta.label); if (!novo) return;
    await salvarConta({ label: novo, accountId: conta.accountId, url: conta.url }); // mantém url/token
  }
  async function removerConta(conta) {
    if (!confirm(`Remover a tela "${conta.label}"? (não apaga nada no Chatwoot, só tira do painel)`)) return;
    const r = await acc("POST", { action: "remove", id: conta.id });
    if (r.ok && r.data.accounts) setContas(r.data.accounts);
    else setMsg("Erro: " + (r.data.error || "falha"));
  }

  async function atribuir(nome, contaId) {
    const novo = { ...assign, [nome]: contaId };
    setAssign(novo); // otimista
    const r = await api("assign_set", { instance: nome, conta: contaId });
    if (r.ok && r.data.assign) setAssign(r.data.assign);
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
    const a = await api("assign_get");
    if (a.ok && a.data.assign) setAssign(a.data.assign);
    const c = await acc("GET");
    if (c.ok && c.data.accounts) setContas(c.data.accounts);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  async function novoOficial(type, accountId) {
    const nome = prompt(`Nome do canal ${type}:`); if (!nome) return;
    // Abre a aba JÁ no gesto do clique. Se abrir depois do await, o navegador BLOQUEIA o popup.
    const win = window.open("about:blank", "_blank");
    setMsg("Criando canal…");
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/connect-channel`, {
      method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type, name: nome, account_id: accountId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.connect_url) { setMsg("Erro: " + (j.error || res.status)); if (win) win.close(); return; }
    if (win) win.location.href = j.connect_url; else window.open(j.connect_url, "_blank");
    setMsg("Canal criado — autorize na Meta na aba que abriu.");
    setAdd(null); carregar();
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Central de Conexões</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Cada tela = um Chatwoot. Adicione canais por tela (oficial ou não-oficial).
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13 }}>{msg}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16, alignItems: "start" }}>
          {contas.map((conta) => {
            // canais oficiais aparecem na conta principal (frontend ainda não sabe a conta por canal).
            const chs = conta.accountId === CHATWOOT_ACCOUNT_ID ? canais : [];
            const uazChs = conta.ativa ? uaz.filter((i) => assign[i.name] === conta.id) : [];
            const principal = conta.accountId === CHATWOOT_ACCOUNT_ID;
            return (
              <div key={conta.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-2)" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{conta.label}</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>conta {conta.accountId}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button className="btn-ghost mini" title="Renomear" onClick={() => renomearConta(conta)}>✎</button>
                    {!principal && <button className="btn-ghost mini" title="Remover do painel" onClick={() => removerConta(conta)}>✕</button>}
                  </div>
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
                      {add !== conta.id ? (
                        <button className="btn-ghost" style={{ width: "100%" }} onClick={() => setAdd(conta.id)}>+ Adicionar canal</button>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <button className="btn-ghost mini" onClick={() => novoOficial("facebook", conta.id)}>Facebook</button>
                          <button className="btn-ghost mini" onClick={() => novoOficial("instagram", conta.id)}>Instagram</button>
                          <button className="btn-ghost mini" onClick={() => novoOficial("whatsapp", conta.id)}>WhatsApp oficial (EVO Hub)</button>
                          <button className="btn-ghost mini" onClick={() => router.push("/instancias")}>WhatsApp não-oficial (uazapi)</button>
                          <button className="btn-ghost mini" onClick={() => setAdd(null)}>Cancelar</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* adicionar outra tela/Chatwoot — form direto no painel */}
          {!novaConta ? (
            <button className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 160, color: "var(--text-faint)", borderStyle: "dashed", cursor: "pointer", background: "var(--surface)" }}
              onClick={() => setNovaConta({ label: "", accountId: "" })}>
              <div style={{ fontSize: 30, marginBottom: 6 }}>+</div>
              <div style={{ fontSize: 14, textAlign: "center" }}>Adicionar Chatwoot<br /><span style={{ fontSize: 12 }}>(conta na mesma instância)</span></div>
            </button>
          ) : (
            <div className="card" style={{ minHeight: 160, display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Nova tela Chatwoot</div>
              <input placeholder="Nome (ex.: Instituto Belém)" value={novaConta.label} onChange={(e) => setNovaConta({ ...novaConta, label: e.target.value })} />
              <input placeholder="account_id (número na URL /accounts/N/)" value={novaConta.accountId} onChange={(e) => setNovaConta({ ...novaConta, accountId: e.target.value })} />
              <label style={{ fontSize: 12, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" checked={novaConta.externo || false} onChange={(e) => setNovaConta({ ...novaConta, externo: e.target.checked })} style={{ width: "auto" }} />
                Chatwoot externo (outra URL / outro cliente)
              </label>
              {novaConta.externo && (
                <>
                  <input placeholder="URL (ex.: https://chat.institutobelem.com)" value={novaConta.url || ""} onChange={(e) => setNovaConta({ ...novaConta, url: e.target.value })} />
                  <input type="password" placeholder="Token da API (cola 1x, some depois)" value={novaConta.token || ""} onChange={(e) => setNovaConta({ ...novaConta, token: e.target.value })} />
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Token fica só no servidor (mascarado depois). Mesmo número/página continua entrando pelo EVO Hub.</div>
                </>
              )}
              {!novaConta.externo && <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Mesma instância e token. Só muda o account_id.</div>}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-mint mini" onClick={() => salvarConta(novaConta)}>Salvar</button>
                <button className="btn-ghost mini" onClick={() => setNovaConta(null)}>Cancelar</button>
              </div>
            </div>
          )}
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
                    {contas.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
              );
            })}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
          O uazapi não informa a qual Chatwoot cada número pertence — atribua a tela aqui. (Salvo no banco; vale em qualquer dispositivo.)
        </div>
      </div>
    </>
  );
}
