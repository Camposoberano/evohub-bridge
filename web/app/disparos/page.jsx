"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import { ufFromPhone, UF_REGIAO } from "@/lib/ddd";
import Nav from "@/components/Nav";

function statusBadge(s) {
  if (s === "connected") return ["badge-green", "Conectado"];
  if (s === "connecting") return ["badge-amber", "Conectando"];
  return ["badge-gray", s || "—"];
}
// extrai números (dígitos, >=12 = 55+DDD+num) de texto livre
function parseNumeros(txt) {
  return (txt.match(/\d[\d\s().-]{9,}/g) || [])
    .map((s) => s.replace(/\D/g, ""))
    .filter((d) => d.length >= 12);
}
const TIPOS = [
  { t: "text", label: "Texto" },
  { t: "image", label: "Imagem" },
  { t: "video", label: "Vídeo" },
  { t: "videoplay", label: "Vídeo nota" },
  { t: "audio", label: "Áudio" },
  { t: "document", label: "Documento" },
  { t: "button", label: "Botões" },
];
const TIPO_MIDIA = new Set(["image", "video", "videoplay", "audio", "document"]);
let _sid = 1;

export default function Disparos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [instancias, setInstancias] = useState([]);
  const [qr, setQr] = useState(null);
  const [msg, setMsg] = useState("");
  const [inst, setInst] = useState("");

  // público
  const [uf, setUf] = useState("nenhum");
  const [manual, setManual] = useState("");
  const [importado, setImportado] = useState([]);
  const [contatos, setContatos] = useState([]);

  // timeline
  const [passos, setPassos] = useState([{ id: _sid++, type: "text", text: "", file: "", choices: "", waitMin: 0 }]);
  const [delayMin, setDelayMin] = useState(1);
  const [delayMax, setDelayMax] = useState(3);
  const [enviando, setEnviando] = useState(false);
  const [verInst, setVerInst] = useState(false);

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
    else setMsg(r.data.error || "Erro ao listar instâncias.");
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

  // público combinado: segmento (UF) + manual + importado, dedup
  const segmentoNums = useMemo(() => contatos
    .map((c) => String(c.phone || c.external_contact_id || "").replace(/\D/g, ""))
    .filter((d) => d.length >= 12)
    .filter((d) => uf !== "nenhum" && (uf === "todos" || ufFromPhone(d) === uf)), [contatos, uf]);
  const publicoUnico = useMemo(() =>
    [...new Set([...segmentoNums, ...parseNumeros(manual), ...importado])],
    [segmentoNums, manual, importado]);
  const ufsPresentes = useMemo(() => [...new Set(contatos.map((c) => ufFromPhone(c.phone || c.external_contact_id)).filter(Boolean))].sort(), [contatos]);

  function importarArquivo(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setImportado([...new Set(parseNumeros(String(reader.result)))]); setMsg(`Importados ${parseNumeros(String(reader.result)).length} números do arquivo.`); };
    reader.readAsText(f);
  }

  // timeline
  function addPasso(type) { setPassos([...passos, { id: _sid++, type, text: "", file: "", choices: "", waitMin: type === "text" && passos.length === 0 ? 0 : 10 }]); }
  function setPasso(id, patch) { setPassos(passos.map((p) => p.id === id ? { ...p, ...patch } : p)); }
  function rmPasso(id) { setPassos(passos.filter((p) => p.id !== id)); }
  function mover(id, dir) {
    const i = passos.findIndex((p) => p.id === id); const j = i + dir;
    if (j < 0 || j >= passos.length) return;
    const cp = [...passos];[cp[i], cp[j]] = [cp[j], cp[i]]; setPassos(cp);
  }

  async function conectar(nome) {
    setMsg("Gerando QR…");
    const r = await api("connect", { instance: nome });
    const d = r.data || {};
    const img = d.qrcode || d.qr || d.instance?.qrcode || null;
    const code = d.paircode || d.pairingCode || d.code || null;
    if (img || code) { setQr({ instance: nome, img, code }); setMsg(""); } else setMsg("Sem QR: " + JSON.stringify(d).slice(0, 200));
  }
  async function checar() {
    if (!inst) return setMsg("Escolha a instância.");
    if (publicoUnico.length === 0) return setMsg("Público vazio.");
    setMsg(`Checando ${publicoUnico.length} números…`);
    const r = await api("check", { instance: inst, numbers: publicoUnico.slice(0, 1000) });
    setMsg("Checagem: " + JSON.stringify(r.data).slice(0, 300));
  }

  async function disparar() {
    if (!inst) return setMsg("Escolha a instância.");
    if (publicoUnico.length === 0) return setMsg("Público vazio.");
    for (const p of passos) {
      if (p.type === "text" && !p.text) return setMsg("Passo de texto sem mensagem.");
      if (TIPO_MIDIA.has(p.type) && !p.file) return setMsg(`Passo de ${p.type} sem URL de mídia.`);
    }
    if (!confirm(`Disparar ${passos.length} passo(s) pra ${publicoUnico.length} números pela "${inst}", delay ${delayMin}-${delayMax} min entre contatos?`)) return;
    setEnviando(true);
    let acumulado = 0;
    const resultados = [];
    for (let i = 0; i < passos.length; i++) {
      const p = passos[i];
      acumulado += Number(p.waitMin) || 0;
      setMsg(`Criando passo ${i + 1}/${passos.length} (${p.type})…`);
      const params = {
        instance: inst, numbers: publicoUnico, type: p.type,
        text: p.text || undefined, file: p.file || undefined,
        delayMin: Math.round(Number(delayMin) * 60), delayMax: Math.round(Number(delayMax) * 60),
        scheduled_for: acumulado, // minutos a partir de agora
        info: `Soberano ${uf !== "nenhum" ? uf : "lista"} p${i + 1}`,
      };
      if (p.type === "button") {
        params.choices = p.choices.split("\n").map((s) => s.trim()).filter(Boolean);
        params.buttonText = "Escolha";
      }
      if (p.type === "document" && p.docName) params.docName = p.docName;
      const r = await api("campaign", params);
      resultados.push(r.ok ? "ok" : (r.data.error || "erro"));
    }
    setEnviando(false);
    setMsg(`Campanha criada. Passos: ${resultados.join(", ")}. Acompanhe no uazapi/Chatwoot.`);
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Disparos</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Campanha com linha do tempo (texto → vídeo → áudio) e espaçamento. Use chips separados, não a WABA oficial.
          </div>
        </div>

        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13, wordBreak: "break-word" }}>{msg}</div>}

        {/* INSTÂNCIAS (recolhe se > 5) */}
        <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Números ({instancias.filter((i) => i.status === "connected").length} conectados / {instancias.length})</span>
          {instancias.length > 5 && <button className="btn-ghost mini" onClick={() => setVerInst(!verInst)}>{verInst ? "Recolher" : "Ver todos"}</button>}
        </div>
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          {instancias.length === 0 ? <div style={{ padding: 16, color: "var(--text-dim)" }}>Nenhuma instância.</div> :
            (verInst ? instancias : instancias.slice(0, 5)).map((i) => {
              const [cls, txt] = statusBadge(i.status);
              return (
                <div key={i.name} className="integ">
                  <div className="integ-body"><div className="integ-name">{i.name}</div><div className="integ-desc">{i.number || "—"}</div></div>
                  <span className={"badge " + cls}>{txt}</span>
                  {i.status !== "connected" && <button className="btn-ghost mini" onClick={() => conectar(i.name)}>Conectar (QR)</button>}
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

        {/* PÚBLICO */}
        <div className="section-title">Público ({publicoUnico.length})</div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Da base, por estado</label><br />
              <select value={uf} onChange={(e) => setUf(e.target.value)} style={{ marginTop: 4 }}>
                <option value="nenhum">Não usar a base</option>
                <option value="todos">Todos da base ({contatos.length})</option>
                {ufsPresentes.map((u) => <option key={u} value={u}>{u} — {UF_REGIAO[u]}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Importar lista (.txt/.csv)</label><br />
              <input type="file" accept=".txt,.csv" onChange={importarArquivo} style={{ marginTop: 6, fontSize: 13 }} />
              {importado.length > 0 && <span className="badge badge-gray" style={{ marginLeft: 8 }}>{importado.length} importados</span>}
            </div>
          </div>
          <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Ou cole números manualmente (um por linha)</label>
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={3} placeholder={"5511999999999\n5551988887777"}
            style={{ width: "100%", marginTop: 6, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
        </div>

        {/* TIMELINE */}
        <div className="section-title">Linha do tempo (passos)</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {TIPOS.map((t) => <button key={t.t} className="btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={() => addPasso(t.t)}>+ {t.label}</button>)}
        </div>
        {passos.map((p, i) => (
          <div key={p.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Passo {i + 1} · {TIPOS.find((x) => x.t === p.type)?.label}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-ghost" style={{ padding: "3px 9px" }} onClick={() => mover(p.id, -1)}>↑</button>
                <button className="btn-ghost" style={{ padding: "3px 9px" }} onClick={() => mover(p.id, 1)}>↓</button>
                <button className="btn-ghost" style={{ padding: "3px 9px" }} onClick={() => rmPasso(p.id)}>✕</button>
              </div>
            </div>
            {i > 0 && (
              <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text-dim)" }}>
                Esperar <input type="number" value={p.waitMin} onChange={(e) => setPasso(p.id, { waitMin: e.target.value })} style={{ width: 70, margin: "0 6px" }} /> min após o passo anterior
              </div>
            )}
            {TIPO_MIDIA.has(p.type) && (
              <input value={p.file} onChange={(e) => setPasso(p.id, { file: e.target.value })} placeholder="URL da mídia (ou base64)" style={{ width: "100%", marginBottom: 8 }} />
            )}
            {p.type === "document" && (
              <input value={p.docName || ""} onChange={(e) => setPasso(p.id, { docName: e.target.value })} placeholder="Nome do arquivo (ex: catalogo.pdf)" style={{ width: "100%", marginBottom: 8 }} />
            )}
            {p.type === "button" && (
              <textarea value={p.choices} onChange={(e) => setPasso(p.id, { choices: e.target.value })} rows={2} placeholder={"Opções dos botões (uma por linha)"}
                style={{ width: "100%", marginBottom: 8, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
            )}
            <textarea value={p.text} onChange={(e) => setPasso(p.id, { text: e.target.value })} rows={2}
              placeholder={p.type === "text" ? "Mensagem…" : "Legenda (opcional)…"}
              style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
          </div>
        ))}

        {/* ENVIO */}
        <div className="card" style={{ marginTop: 6 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Instância:</label>
            <select value={inst} onChange={(e) => setInst(e.target.value)}>
              <option value="">Escolha…</option>
              {instancias.filter((i) => i.status === "connected").map((i) => <option key={i.name} value={i.name}>{i.name} — {i.number}</option>)}
            </select>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Delay entre contatos (min):</label>
            <input type="number" step="0.5" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} style={{ width: 70 }} />
            <span style={{ color: "var(--text-faint)" }}>a</span>
            <input type="number" step="0.5" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} style={{ width: 70 }} />
            <button className="btn-ghost" style={{ padding: "6px 12px", fontSize: 13 }} onClick={checar} disabled={!inst}>Checar números</button>
          </div>
          <button className="btn-mint" onClick={disparar} disabled={enviando} style={{ width: "100%", justifyContent: "center" }}>
            {enviando ? "Criando…" : `Disparar ${passos.length} passo(s) pra ${publicoUnico.length} números`}
          </button>
        </div>
      </div>
    </>
  );
}
