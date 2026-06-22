"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import { ufFromPhone, UF_REGIAO } from "@/lib/ddd";
import Nav from "@/components/Nav";

function statusBadge(s) {
  if (s === "connected") return ["badge-green", "Conectado"];
  return ["badge-gray", s || "—"];
}
function parseNumeros(txt) {
  return (txt.match(/\d[\d\s().-]{9,}/g) || []).map((s) => s.replace(/\D/g, "")).filter((d) => d.length >= 12);
}
function parseLista(txt) { return (txt || "").split("\n").map((s) => s.trim()).filter(Boolean); }
function fileToB64(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function kb(n) { return n ? `${Math.round(n / 1024)} KB` : ""; }

const TIPOS = [
  { t: "text", label: "Texto" },
  { t: "image", label: "Imagem" },
  { t: "video", label: "Vídeo" },
  { t: "videoplay", label: "Vídeo nota" },
  { t: "audio", label: "Áudio" },
  { t: "document", label: "Documento" },
  { t: "button", label: "Botões" },
  { t: "list", label: "Lista" },
  { t: "poll", label: "Enquete" },
  { t: "carousel", label: "Carrossel" },
];
const MIDIA = new Set(["image", "video", "videoplay", "audio", "document"]);
let _sid = 1;

export default function Disparos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [instancias, setInstancias] = useState([]);
  const [qr, setQr] = useState(null);
  const [msg, setMsg] = useState("");
  const [inst, setInst] = useState("");
  const [verInst, setVerInst] = useState(false);

  // público
  const [fonte, setFonte] = useState("contatos"); // contatos (já conversou) | clientes (lista fria enriquecida via uazapi)
  const [uf, setUf] = useState("nenhum");
  const [manual, setManual] = useState("");
  const [importado, setImportado] = useState([]);
  const [contatos, setContatos] = useState([]);
  const [clientesNums, setClientesNums] = useState([]);
  const [clientesUfs, setClientesUfs] = useState([]);

  // timeline + opções
  const [passos, setPassos] = useState([{ id: _sid++, type: "text", text: "", file: "", choices: "", footerText: "", listButton: "Ver opções", selectableCount: 1, docName: "", waitMin: 0 }]);
  const [delayMin, setDelayMin] = useState(1);
  const [delayMax, setDelayMax] = useState(3);
  const [presenca, setPresenca] = useState(true);
  const [pularBloq, setPularBloq] = useState(true);
  const [etiquetas, setEtiquetas] = useState([]);
  const [etiqueta, setEtiqueta] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function api(action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/uazapi`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  async function get(path) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  const carregar = useCallback(async () => {
    const r = await api("instances");
    if (r.ok && r.data.instances) setInstancias(r.data.instances);
    const ct = await supabase.from("contacts").select("external_contact_id,phone,attributes,channels(type)").limit(5000);
    setContatos((ct.data || []).filter((c) => c.channels?.type === "whatsapp" && !(c.attributes || {}).dead));
    // estados disponíveis na base de clientes enriquecidos (uazapi) -- pra fonte "clientes".
    const cs = await get("/clientes?stats=1");
    if (cs.ok) setClientesUfs((cs.data.por_uf || []).map((p) => p.uf));
  }, []);

  // quando a fonte é "clientes" e um estado é escolhido, busca os telefones confirmados
  // no WhatsApp (enrich.ts) direto da tabela clientes -- são prospects, não contatos.
  useEffect(() => {
    if (fonte !== "clientes" || uf === "nenhum") { setClientesNums([]); return; }
    const params = new URLSearchParams({ export: "1" });
    if (uf !== "todos") params.set("uf", uf);
    get(`/clientes?${params}`).then((r) => { if (r.ok) setClientesNums(r.data.phones || []); });
  }, [fonte, uf]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  // carrega etiquetas quando muda instância
  useEffect(() => {
    if (!inst) return;
    api("labels", { instance: inst }).then((r) => {
      const d = r.data;
      const arr = Array.isArray(d) ? d : (d?.labels || d?.data || []);
      setEtiquetas(arr.map((l) => ({ id: l.id ?? l.labelId ?? l.Id, name: l.name ?? l.Name ?? l.title })).filter((l) => l.id));
    });
  }, [inst]);

  const segmentoNums = useMemo(() => {
    if (fonte === "clientes") return clientesNums; // já vem filtrado por UF/on_whatsapp do bridge
    return contatos.map((c) => String(c.phone || c.external_contact_id || "").replace(/\D/g, ""))
      .filter((d) => d.length >= 12).filter((d) => uf !== "nenhum" && (uf === "todos" || ufFromPhone(d) === uf));
  }, [fonte, contatos, clientesNums, uf]);
  const publicoUnico = useMemo(() => [...new Set([...segmentoNums, ...parseNumeros(manual), ...importado])], [segmentoNums, manual, importado]);
  const ufsPresentes = useMemo(() => {
    if (fonte === "clientes") return clientesUfs;
    return [...new Set(contatos.map((c) => ufFromPhone(c.phone || c.external_contact_id)).filter(Boolean))].sort();
  }, [fonte, contatos, clientesUfs]);

  function importarArquivo(e) {
    const f = e.target.files?.[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { const n = [...new Set(parseNumeros(String(reader.result)))]; setImportado(n); setMsg(`Importados ${n.length} números.`); };
    reader.readAsText(f);
  }

  function addPasso(type) { setPassos([...passos, { id: _sid++, type, text: "", file: "", fileName: "", choices: "", b1: "", b2: "", b3: "", footerText: "", listButton: "Ver opções", selectableCount: 1, docName: "", cards: [], waitMin: passos.length ? 10 : 0 }]); }
  // carrossel: cards aninhados
  function addCard(id) { setPassos((ps) => ps.map((p) => p.id === id ? { ...p, cards: [...(p.cards || []), { cid: _sid++, file: "", fileName: "", text: "", b1: "", b2: "", b3: "" }] } : p)); }
  function setCard(id, cid, patch) { setPassos((ps) => ps.map((p) => p.id === id ? { ...p, cards: p.cards.map((c) => c.cid === cid ? { ...c, ...patch } : c) } : p)); }
  function rmCard(id, cid) { setPassos((ps) => ps.map((p) => p.id === id ? { ...p, cards: p.cards.filter((c) => c.cid !== cid) } : p)); }
  async function onCardFile(id, cid, e) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 16 * 1024 * 1024) { setMsg("Arquivo > 16MB."); return; }
    const b64 = await fileToB64(f);
    setCard(id, cid, { file: b64, fileName: `${f.name} (${kb(f.size)})` });
  }
  function buildCards(p) {
    return (p.cards || []).map((c) => {
      const card = { text: c.text || undefined };
      if (c.file) { if (c.file.startsWith("data:video")) card.video = c.file; else card.image = c.file; }
      const btns = [c.b1, c.b2, c.b3].map((s) => (s || "").trim()).filter(Boolean).map((t, i) => ({ id: `b${i}`, text: t, type: "REPLY" }));
      if (btns.length) card.buttons = btns;
      return card;
    });
  }
  function setPasso(id, patch) { setPassos((ps) => ps.map((p) => p.id === id ? { ...p, ...patch } : p)); }
  function rmPasso(id) { setPassos(passos.filter((p) => p.id !== id)); }
  async function onFile(id, e) {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 16 * 1024 * 1024) { setMsg("Arquivo > 16MB — use URL pra arquivos grandes."); return; }
    setMsg(`Lendo ${f.name}…`);
    const b64 = await fileToB64(f);
    setPasso(id, { file: b64, fileName: `${f.name} (${kb(f.size)})`, docName: f.name });
    setMsg("");
  }
  function mover(id, dir) { const i = passos.findIndex((p) => p.id === id), j = i + dir; if (j < 0 || j >= passos.length) return; const cp = [...passos];[cp[i], cp[j]] = [cp[j], cp[i]]; setPassos(cp); }

  async function conectar(nome) {
    setMsg("QR…"); const r = await api("connect", { instance: nome }); const d = r.data || {};
    const img = d.qrcode || d.qr || d.instance?.qrcode || null; const code = d.paircode || d.pairingCode || d.code || null;
    if (img || code) setQr({ instance: nome, img, code }); else setMsg("Sem QR: " + JSON.stringify(d).slice(0, 160));
  }

  function paramsDoPasso(p) {
    const out = { type: p.type, text: p.text || undefined };
    if (MIDIA.has(p.type)) out.file = p.file || undefined;
    if (p.type === "document" && p.docName) out.docName = p.docName;
    if (p.type === "button") { out.choices = [p.b1, p.b2, p.b3].map((s) => (s || "").trim()).filter(Boolean); out.buttonText = "Escolha"; if (p.file) out.imageButton = p.file; if (p.footerText) out.footerText = p.footerText; }
    if (p.type === "list") { out.choices = parseLista(p.choices); out.listButton = p.listButton || "Ver opções"; if (p.footerText) out.footerText = p.footerText; }
    if (p.type === "poll") { out.choices = parseLista(p.choices); out.selectableCount = Number(p.selectableCount) || 1; }
    if (presenca) out.delay = 3000; // simula digitando/gravando ~3s
    return out;
  }

  async function disparar() {
    if (!inst) return setMsg("Escolha a instância.");
    let alvo = publicoUnico;
    if (alvo.length === 0) return setMsg("Público vazio.");
    for (const p of passos) {
      if (p.type === "text" && !p.text) return setMsg("Passo de texto sem mensagem.");
      if (MIDIA.has(p.type) && !p.file) return setMsg(`Passo de ${p.type} sem URL.`);
      if (p.type === "button" && [p.b1, p.b2, p.b3].filter((s) => (s || "").trim()).length === 0) return setMsg("Passo de botões sem nenhum botão.");
      if ((p.type === "list" || p.type === "poll") && parseLista(p.choices).length === 0) return setMsg(`Passo ${p.type} sem opções.`);
      if (p.type === "carousel" && (p.cards || []).length === 0) return setMsg("Carrossel sem cards.");
    }
    setEnviando(true);
    if (pularBloq) {
      setMsg("Removendo bloqueados…");
      const r = await api("block_filter", { instance: inst, numbers: alvo });
      if (r.ok && r.data.allowed) { const rem = r.data.removed || 0; alvo = r.data.allowed; if (rem) setMsg(`${rem} bloqueados removidos.`); }
    }
    if (!confirm(`Disparar ${passos.length} passo(s) pra ${alvo.length} números pela "${inst}"?`)) { setEnviando(false); return; }
    let acumulado = 0;
    for (let i = 0; i < passos.length; i++) {
      const p = passos[i]; acumulado += Number(p.waitMin) || 0;
      setMsg(`Passo ${i + 1}/${passos.length} (${p.type})…`);
      if (p.type === "carousel") {
        await api("campaign_carousel", { instance: inst, numbers: alvo, text: p.text || "", carousel: buildCards(p) });
      } else {
        await api("campaign", {
          instance: inst, numbers: alvo, ...paramsDoPasso(p),
          delayMin: Math.round(Number(delayMin) * 60), delayMax: Math.round(Number(delayMax) * 60),
          scheduled_for: acumulado, info: `Soberano ${uf !== "nenhum" ? uf : "lista"} p${i + 1}`,
        });
      }
    }
    if (etiqueta) { setMsg("Etiquetando quem recebeu…"); const r = await api("label_bulk", { instance: inst, numbers: alvo, labelIds: [etiqueta] }); setMsg(`Disparo criado. Etiqueta aplicada em ${r.data?.applied ?? 0}/${alvo.length}.`); }
    else setMsg(`Disparo criado pra ${alvo.length} números.`);
    setEnviando(false);
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Disparos</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Campanha com linha do tempo, tipos ricos e anti-ban. Use chips separados.</div>
        </div>
        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13, wordBreak: "break-word" }}>{msg}</div>}

        {/* INSTÂNCIAS */}
        <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>Números ({instancias.filter((i) => i.status === "connected").length} conectados / {instancias.length})</span>
          {instancias.length > 5 && <button className="btn-ghost mini" onClick={() => setVerInst(!verInst)}>{verInst ? "Recolher" : "Ver todos"}</button>}
        </div>
        <div className="table-wrap" style={{ marginBottom: 16 }}>
          {(verInst ? instancias : instancias.slice(0, 5)).map((i) => {
            const [cls, txt] = statusBadge(i.status);
            return (<div key={i.name} className="integ"><div className="integ-body"><div className="integ-name">{i.name}</div><div className="integ-desc">{i.number || "—"}</div></div><span className={"badge " + cls}>{txt}</span>{i.status !== "connected" && <button className="btn-ghost mini" onClick={() => conectar(i.name)}>Conectar (QR)</button>}</div>);
          })}
        </div>
        {qr && (
          <div className="card" style={{ marginBottom: 16, textAlign: "center" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Conectar "{qr.instance}"</div>
            {qr.img && <img src={qr.img.startsWith("data:") ? qr.img : `data:image/png;base64,${qr.img}`} alt="QR" style={{ width: 230, height: 230 }} />}
            {qr.code && <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 2 }}>{qr.code}</div>}
            <div><button className="btn-ghost" style={{ marginTop: 10 }} onClick={() => setQr(null)}>Fechar</button></div>
          </div>
        )}

        {/* PÚBLICO */}
        <div className="section-title">Público ({publicoUnico.length})</div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <select value={fonte} onChange={(e) => { setFonte(e.target.value); setUf("nenhum"); }}>
              <option value="contatos">Contatos (já conversou)</option>
              <option value="clientes">Clientes (lista fria, confirmado no WhatsApp)</option>
            </select>
            <select value={uf} onChange={(e) => setUf(e.target.value)}>
              <option value="nenhum">Não usar a base</option>
              <option value="todos">Todos da base ({fonte === "clientes" ? "todos estados" : contatos.length})</option>
              {ufsPresentes.map((u) => <option key={u} value={u}>{u} — {UF_REGIAO[u]}</option>)}
            </select>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Importar: <input type="file" accept=".txt,.csv" onChange={importarArquivo} style={{ fontSize: 13 }} /></label>
            {importado.length > 0 && <span className="badge badge-gray">{importado.length} importados</span>}
          </div>
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={3} placeholder={"Colar números (um por linha)"} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
        </div>

        {/* TIMELINE */}
        <div className="section-title">Linha do tempo</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {TIPOS.map((t) => <button key={t.t} className="btn-ghost mini" onClick={() => addPasso(t.t)}>+ {t.label}</button>)}
        </div>
        {passos.map((p, i) => (
          <div key={p.id} className="card passo" style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 600 }}>Passo {i + 1} · {TIPOS.find((x) => x.t === p.type)?.label}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn-ghost mini" onClick={() => mover(p.id, -1)}>↑</button>
                <button className="btn-ghost mini" onClick={() => mover(p.id, 1)}>↓</button>
                <button className="btn-ghost mini" onClick={() => rmPasso(p.id)}>✕</button>
              </div>
            </div>
            {i > 0 && <div style={{ marginBottom: 8, fontSize: 13, color: "var(--text-dim)" }}>Esperar <input type="number" value={p.waitMin} onChange={(e) => setPasso(p.id, { waitMin: e.target.value })} style={{ width: 70, margin: "0 6px" }} /> min após o anterior</div>}

            {/* upload de mídia (vira base64) — image/video/videoplay/audio/document e imagem do botão */}
            {(MIDIA.has(p.type) || p.type === "button") && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: "var(--text-dim)" }}>{p.type === "button" ? "Imagem do botão (opcional)" : "Arquivo do computador"}</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                  <input type="file" onChange={(e) => onFile(p.id, e)}
                    accept={p.type === "image" || p.type === "button" ? "image/*" : p.type === "audio" ? "audio/*" : p.type === "document" ? "*" : "video/*"}
                    style={{ fontSize: 13 }} />
                  {p.fileName && <span className="badge badge-green" style={{ fontSize: 11 }}>{p.fileName}</span>}
                  {p.file && <button className="btn-ghost mini" onClick={() => setPasso(p.id, { file: "", fileName: "" })}>limpar</button>}
                </div>
                <input value={p.file?.startsWith("data:") ? "" : (p.file || "")} onChange={(e) => setPasso(p.id, { file: e.target.value, fileName: "" })}
                  placeholder="…ou cole uma URL (p/ arquivos grandes)" style={{ width: "100%", marginTop: 6, fontSize: 13 }} />
              </div>
            )}

            {p.type === "document" && <input value={p.docName} onChange={(e) => setPasso(p.id, { docName: e.target.value })} placeholder="Nome do arquivo (ex: catalogo.pdf)" style={{ width: "100%", marginBottom: 8 }} />}

            {/* BOTÕES: até 3, cada um seu campo */}
            {p.type === "button" && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 12, color: "var(--text-dim)" }}>Botões (até 3)</label>
                {["b1", "b2", "b3"].map((b, idx) => (
                  <input key={b} value={p[b]} onChange={(e) => setPasso(p.id, { [b]: e.target.value })} placeholder={`Botão ${idx + 1}`} style={{ width: "100%", marginTop: 6 }} />
                ))}
              </div>
            )}

            {p.type === "list" && <input value={p.listButton} onChange={(e) => setPasso(p.id, { listButton: e.target.value })} placeholder="Texto do botão da lista" style={{ width: "100%", marginBottom: 8 }} />}
            {p.type === "poll" && <input type="number" value={p.selectableCount} onChange={(e) => setPasso(p.id, { selectableCount: e.target.value })} placeholder="Qtd selecionável" style={{ width: 160, marginBottom: 8 }} />}
            {(p.type === "list" || p.type === "poll") && <textarea value={p.choices} onChange={(e) => setPasso(p.id, { choices: e.target.value })} rows={3} placeholder={"Opções (uma por linha)"} style={{ width: "100%", marginBottom: 8, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />}

            {/* CARROSSEL: cards (imagem/vídeo upload + texto + botões) */}
            {p.type === "carousel" && (
              <div style={{ marginBottom: 8 }}>
                {(p.cards || []).map((c, ci) => (
                  <div key={c.cid} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 8, background: "var(--surface-2)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>Card {ci + 1}</span>
                      <button className="btn-ghost mini" onClick={() => rmCard(p.id, c.cid)}>✕</button>
                    </div>
                    <input type="file" accept="image/*,video/*" onChange={(e) => onCardFile(p.id, c.cid, e)} style={{ fontSize: 13 }} />
                    {c.fileName && <span className="badge badge-green" style={{ fontSize: 11, marginLeft: 6 }}>{c.fileName}</span>}
                    <textarea value={c.text} onChange={(e) => setCard(p.id, c.cid, { text: e.target.value })} rows={2} placeholder="Texto do card" style={{ width: "100%", margin: "8px 0", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 8, fontFamily: "inherit" }} />
                    {["b1", "b2", "b3"].map((b, bi) => <input key={b} value={c[b]} onChange={(e) => setCard(p.id, c.cid, { [b]: e.target.value })} placeholder={`Botão ${bi + 1} (opcional)`} style={{ width: "100%", marginBottom: 6, fontSize: 13 }} />)}
                  </div>
                ))}
                <button className="btn-ghost mini" onClick={() => addCard(p.id)}>+ Adicionar card</button>
              </div>
            )}

            <textarea value={p.text} onChange={(e) => setPasso(p.id, { text: e.target.value })} rows={2} placeholder={p.type === "text" ? "Mensagem…" : p.type === "poll" ? "Pergunta…" : p.type === "button" || p.type === "list" ? "Texto do card…" : "Legenda (opcional)…"} style={{ width: "100%", marginBottom: (p.type === "button" || p.type === "list") ? 8 : 0, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
            {(p.type === "button" || p.type === "list") && <input value={p.footerText} onChange={(e) => setPasso(p.id, { footerText: e.target.value })} placeholder="Rodapé (opcional)" style={{ width: "100%" }} />}
          </div>
        ))}
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginBottom: 16 }}>Carrossel envia por loop (cap 1000/disparo, não usa o agendamento da timeline). Figurinha = envio avulso.</div>

        {/* ENVIO */}
        <div className="card">
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Instância:</label>
            <select value={inst} onChange={(e) => setInst(e.target.value)}>
              <option value="">Escolha…</option>
              {instancias.filter((i) => i.status === "connected").map((i) => <option key={i.name} value={i.name}>{i.name} — {i.number}</option>)}
            </select>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Delay (min):</label>
            <input type="number" step="0.5" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} style={{ width: 64 }} />
            <span style={{ color: "var(--text-faint)" }}>a</span>
            <input type="number" step="0.5" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} style={{ width: 64 }} />
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 14, flexWrap: "wrap", fontSize: 13, color: "var(--text-dim)" }}>
            <label><input type="checkbox" checked={presenca} onChange={(e) => setPresenca(e.target.checked)} /> Simular digitando/gravando</label>
            <label><input type="checkbox" checked={pularBloq} onChange={(e) => setPularBloq(e.target.checked)} /> Pular bloqueados</label>
            <label>Etiquetar quem recebeu:
              <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} style={{ marginLeft: 6 }}>
                <option value="">— não —</option>
                {etiquetas.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          </div>
          <button className="btn-mint" onClick={disparar} disabled={enviando} style={{ width: "100%", justifyContent: "center" }}>
            {enviando ? "Criando…" : `Disparar ${passos.length} passo(s) pra ${publicoUnico.length} números`}
          </button>
        </div>
      </div>
    </>
  );
}
