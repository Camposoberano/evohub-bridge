"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import { ufFromPhone, UF_REGIAO } from "@/lib/ddd";
import Nav from "@/components/Nav";

function statusBadge(s) {
  if (s === "connected") return ["badge-green", "Conectado"];
  if (s === "connecting") return ["badge-amber", "Conectando"];
  return ["badge-gray", s || "—"];
}

export default function Disparos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [instancias, setInstancias] = useState([]);
  const [qr, setQr] = useState(null); // {instance, img, code}
  const [msg, setMsg] = useState("");

  // campanha
  const [inst, setInst] = useState("");
  const [uf, setUf] = useState("todos");
  const [texto, setTexto] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [tipo, setTipo] = useState("text");
  const [delayMin, setDelayMin] = useState(60);
  const [delayMax, setDelayMax] = useState(180);
  const [contatos, setContatos] = useState([]);
  const [enviando, setEnviando] = useState(false);

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
    if (r.ok && r.data.instances) setInstancias(r.data.instances);
    else setMsg(r.data.error || "Erro ao listar instâncias (bridge tem UAZAPI configurado?)");
    const ct = await supabase.from("contacts").select("external_contact_id,phone,attributes,channels(type)").limit(5000);
    setContatos((ct.data || []).filter((c) => c.channels?.type === "whatsapp" && !(c.attributes || {}).dead));
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  // público = números dos contatos WA (filtrado por UF), só dígitos
  const publico = contatos
    .map((c) => String(c.phone || c.external_contact_id || "").replace(/\D/g, ""))
    .filter((d) => d.length >= 12)
    .filter((d) => uf === "todos" || ufFromPhone(d) === uf);
  const publicoUnico = [...new Set(publico)];

  const ufsPresentes = [...new Set(contatos.map((c) => ufFromPhone(c.phone || c.external_contact_id)).filter(Boolean))].sort();

  async function conectar(nome) {
    setMsg("Gerando QR…");
    const r = await api("connect", { instance: nome });
    const d = r.data || {};
    const img = d.qrcode || d.qr || d.instance?.qrcode || null;
    const code = d.paircode || d.pairingCode || d.code || null;
    if (img || code) { setQr({ instance: nome, img, code }); setMsg(""); }
    else setMsg("Sem QR na resposta: " + JSON.stringify(d).slice(0, 200));
  }

  async function checar() {
    if (publicoUnico.length === 0) return setMsg("Público vazio.");
    setMsg(`Checando ${publicoUnico.length} números…`);
    const r = await api("check", { instance: inst, numbers: publicoUnico.slice(0, 1000) });
    setMsg("Resultado checagem: " + JSON.stringify(r.data).slice(0, 300));
  }

  async function disparar() {
    if (!inst) return setMsg("Escolha a instância.");
    if (publicoUnico.length === 0) return setMsg("Público vazio.");
    if (tipo === "text" && !texto) return setMsg("Escreva a mensagem.");
    if (tipo !== "text" && !fileUrl) return setMsg("Informe a URL da mídia.");
    if (!confirm(`Disparar pra ${publicoUnico.length} números pela instância "${inst}", delay ${delayMin}-${delayMax}s?`)) return;
    setEnviando(true);
    setMsg("Criando campanha…");
    const r = await api("campaign", {
      instance: inst, numbers: publicoUnico, type: tipo,
      text: texto || undefined, file: fileUrl || undefined,
      delayMin: Number(delayMin), delayMax: Number(delayMax),
      info: `Soberano ${uf !== "todos" ? uf : "geral"}`,
    });
    setEnviando(false);
    setMsg(r.ok ? "Campanha criada! " + JSON.stringify(r.data).slice(0, 200) : "Erro: " + (r.data.error || JSON.stringify(r.data).slice(0, 200)));
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Disparos (uazapi)</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            WhatsApp não-oficial — campanhas com espaçamento. Use chips separados, não a WABA oficial.
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13, wordBreak: "break-word" }}>{msg}</div>}

        <div className="section-title">Instâncias / números</div>
        <div className="table-wrap" style={{ marginBottom: 8 }}>
          {instancias.length === 0 ? (
            <div style={{ padding: 18, color: "var(--text-dim)" }}>Nenhuma instância (ou bridge sem UAZAPI configurado).</div>
          ) : instancias.map((i) => {
            const [cls, txt] = statusBadge(i.status);
            return (
              <div key={i.name} className="integ">
                <div className="integ-body">
                  <div className="integ-name">{i.name}</div>
                  <div className="integ-desc">{i.number || "—"}</div>
                </div>
                <span className={"badge " + cls}>{txt}</span>
                {i.status !== "connected" && (
                  <button className="btn-ghost" style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => conectar(i.name)}>Conectar (QR)</button>
                )}
              </div>
            );
          })}
        </div>

        {qr && (
          <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Conectar "{qr.instance}" — escaneie no WhatsApp</div>
            {qr.img && <img src={qr.img.startsWith("data:") ? qr.img : `data:image/png;base64,${qr.img}`} alt="QR" style={{ width: 240, height: 240 }} />}
            {qr.code && <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2, marginTop: 8 }}>{qr.code}</div>}
            <div><button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setQr(null)}>Fechar</button></div>
          </div>
        )}

        <div className="section-title">Nova campanha</div>
        <div className="card">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Instância (número de envio)</label>
              <select value={inst} onChange={(e) => setInst(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                <option value="">Escolha…</option>
                {instancias.filter((i) => i.status === "connected").map((i) => <option key={i.name} value={i.name}>{i.name} — {i.number}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Público por estado</label>
              <select value={uf} onChange={(e) => setUf(e.target.value)} style={{ width: "100%", marginTop: 4 }}>
                <option value="todos">Todos ({contatos.length})</option>
                {ufsPresentes.map((u) => <option key={u} value={u}>{u} — {UF_REGIAO[u]}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge badge-green">{publicoUnico.length} números no público</span>
            <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={checar} disabled={!inst}>Checar números (mortos)</button>
          </div>

          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            {["text", "image", "video", "audio"].map((t) => (
              <button key={t} className={"tab" + (tipo === t ? " tab-active" : "")} onClick={() => setTipo(t)}>{t}</button>
            ))}
          </div>

          {tipo !== "text" && (
            <input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder="URL da mídia (imagem/vídeo/áudio)" style={{ width: "100%", marginBottom: 10 }} />
          )}
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={tipo === "text" ? "Mensagem…" : "Legenda (opcional)…"}
            rows={4} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, marginBottom: 12, fontFamily: "inherit" }} />

          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Espaçamento (s):</label>
            <input type="number" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} style={{ width: 80 }} />
            <span style={{ color: "var(--text-faint)" }}>a</span>
            <input type="number" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} style={{ width: 80 }} />
            <span style={{ fontSize: 12, color: "var(--text-faint)" }}>aleatório entre envios (anti-ban)</span>
          </div>

          <button className="btn-mint" onClick={disparar} disabled={enviando} style={{ width: "100%", justifyContent: "center" }}>
            {enviando ? "Criando…" : `Disparar pra ${publicoUnico.length} números`}
          </button>
        </div>
      </div>
    </>
  );
}
