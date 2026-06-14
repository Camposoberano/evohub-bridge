"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";
import Menu from "@/components/Menu";

function statusBadge(s) {
  if (s === "connected") return ["badge-green", "Conectado"];
  if (s === "connecting") return ["badge-amber", "Conectando"];
  return ["badge-gray", s || "—"];
}

export default function Instancias() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [insts, setInsts] = useState([]);
  const [msg, setMsg] = useState("");
  const [qr, setQr] = useState(null);
  const [painel, setPainel] = useState(null); // {instance, tipo:'proxy'|'chatwoot'|'limits', data}

  async function api(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/uazapi`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...params }),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  const carregar = useCallback(async () => {
    const r = await api("instances");
    if (r.ok && r.data.instances) setInsts(r.data.instances);
    else setMsg(r.data.error || "Erro ao listar.");
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  async function act(action, instance, extra = {}, recarrega = true) {
    setMsg(`${action}…`);
    const r = await api(action, { instance, ...extra });
    setMsg(`${action}: ${r.ok ? "ok" : (r.data.error || JSON.stringify(r.data).slice(0, 160))}`);
    if (recarrega) carregar();
    return r;
  }

  async function conectar(nome) {
    setMsg("QR…");
    const r = await api("connect", { instance: nome });
    const d = r.data || {};
    const img = d.qrcode || d.qr || d.instance?.qrcode || null;
    const code = d.paircode || d.pairingCode || d.code || null;
    if (img || code) setQr({ instance: nome, img, code }); else setMsg("Sem QR: " + JSON.stringify(d).slice(0, 160));
  }
  async function criar() {
    const nome = prompt("Nome da nova instância:"); if (!nome) return;
    await act("create", undefined, { name: nome });
  }
  async function renomear(nome) {
    const novo = prompt("Novo nome:", nome); if (!novo || novo === nome) return;
    await act("rename", nome, { name: novo });
  }
  async function deletar(nome) {
    if (!confirm(`Deletar instância "${nome}"? Não dá pra desfazer.`)) return;
    await act("delete", nome);
  }
  async function verLimites(nome) {
    const r = await api("limits", { instance: nome });
    setPainel({ instance: nome, tipo: "limits", data: r.data });
  }
  async function abrirProxy(nome) {
    const r = await api("proxy_get", { instance: nome });
    setPainel({ instance: nome, tipo: "proxy", data: r.data, form: { host: "", port: "", username: "", password: "" } });
  }
  async function salvarProxy() {
    const f = painel.form;
    const r = await api("proxy_set", { instance: painel.instance, proxy: f });
    setMsg("proxy: " + (r.ok ? "salvo" : (r.data.error || "erro")));
    setPainel(null);
  }
  async function abrirChatwoot(nome) {
    const r = await api("chatwoot_get", { instance: nome });
    const cur = r.data || {};
    setPainel({ instance: nome, tipo: "chatwoot", data: cur, form: { enabled: cur.enabled ?? true, inbox_id: cur.inbox_id ?? "" } });
  }
  async function salvarChatwoot() {
    const r = await api("chatwoot_set", { instance: painel.instance, config: painel.form });
    setMsg("chatwoot: " + (r.ok ? "ligado" : (r.data.error || "erro")));
    setPainel(null);
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18, gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Instâncias (uazapi)</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Conectar, proxy, limites e Chatwoot por número</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-ghost" onClick={() => act("restart_api", undefined, {}, false)}>Reiniciar API</button>
            <button className="btn-mint" onClick={criar}>+ Nova instância</button>
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13, wordBreak: "break-word" }}>{msg}</div>}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {insts.map((i) => {
            const [cls, txt] = statusBadge(i.status);
            return (
              <div key={i.name} className="card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 700 }}>{i.name}</span>
                  <span className={"badge " + cls}>{txt}</span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 12 }}>{i.number || "—"}</div>
                <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center" }}>
                  {i.status === "connected"
                    ? <button className="btn-ghost mini" onClick={() => act("disconnect", i.name)}>Desconectar</button>
                    : <button className="btn-mint" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => conectar(i.name)}>Conectar (QR)</button>}
                  <Menu items={[
                    { label: "Reiniciar", onClick: () => act("restart_instance", i.name, {}, false) },
                    { label: "Limites", onClick: () => verLimites(i.name) },
                    { label: "Renomear", onClick: () => renomear(i.name) },
                    { label: "Proxy", onClick: () => abrirProxy(i.name) },
                    { label: "Chatwoot", onClick: () => abrirChatwoot(i.name) },
                    { label: "Deletar", onClick: () => deletar(i.name), danger: true },
                  ]} />
                </div>
              </div>
            );
          })}
        </div>

        {qr && (
          <Modal onClose={() => setQr(null)} title={`Conectar "${qr.instance}"`}>
            {qr.img && <img src={qr.img.startsWith("data:") ? qr.img : `data:image/png;base64,${qr.img}`} alt="QR" style={{ width: 240, height: 240 }} />}
            {qr.code && <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, marginTop: 8 }}>{qr.code}</div>}
            <div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 8 }}>Escaneie no WhatsApp → Aparelhos conectados.</div>
          </Modal>
        )}

        {painel?.tipo === "limits" && (
          <Modal onClose={() => setPainel(null)} title={`Limites — ${painel.instance}`}>
            <pre style={{ fontSize: 12, color: "var(--text-dim)", whiteSpace: "pre-wrap", textAlign: "left" }}>{JSON.stringify(painel.data, null, 2).slice(0, 800)}</pre>
          </Modal>
        )}

        {painel?.tipo === "proxy" && (
          <Modal onClose={() => setPainel(null)} title={`Proxy — ${painel.instance}`}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 8 }}>Atual: {JSON.stringify(painel.data).slice(0, 120)}</div>
              {["host", "port", "username", "password"].map((k) => (
                <input key={k} placeholder={k} value={painel.form[k]}
                  onChange={(e) => setPainel({ ...painel, form: { ...painel.form, [k]: e.target.value } })}
                  style={{ width: "100%", marginBottom: 8 }} />
              ))}
              <button className="btn-mint" style={{ width: "100%", justifyContent: "center" }} onClick={salvarProxy}>Salvar proxy</button>
            </div>
          </Modal>
        )}

        {painel?.tipo === "chatwoot" && (
          <Modal onClose={() => setPainel(null)} title={`Chatwoot — ${painel.instance}`}>
            <div style={{ textAlign: "left" }}>
              <div style={{ fontSize: 13, color: "var(--text-dim)", marginBottom: 10 }}>
                URL/token/conta vêm do servidor (seguro). Informe o <b>inbox_id</b> do Chatwoot pra este número.
              </div>
              <label style={{ fontSize: 13 }}><input type="checkbox" checked={painel.form.enabled}
                onChange={(e) => setPainel({ ...painel, form: { ...painel.form, enabled: e.target.checked } })} /> Integração ativa</label>
              <input placeholder="inbox_id" value={painel.form.inbox_id}
                onChange={(e) => setPainel({ ...painel, form: { ...painel.form, inbox_id: e.target.value } })}
                style={{ width: "100%", margin: "10px 0" }} />
              <button className="btn-mint" style={{ width: "100%", justifyContent: "center" }} onClick={salvarChatwoot}>Ligar Chatwoot</button>
            </div>
          </Modal>
        )}
      </div>
    </>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, zIndex: 50 }} onClick={onClose}>
      <div className="card" style={{ width: 420, maxWidth: "100%", textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 14 }}>{title}</div>
        {children}
        <div><button className="btn-ghost" style={{ marginTop: 14 }} onClick={onClose}>Fechar</button></div>
      </div>
    </div>
  );
}
