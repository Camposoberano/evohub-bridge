"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import { ufFromPhone, UF_REGIAO } from "@/lib/ddd";
import Nav from "@/components/Nav";

function nums(txt) { return (txt.match(/\d[\d\s().-]{9,}/g) || []).map((s) => s.replace(/\D/g, "")).filter((d) => d.length >= 12); }
let _sid = 1;

export default function Campanhas() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [tpl, setTpl] = useState("");
  const [headerUrl, setHeaderUrl] = useState("");
  const [contatos, setContatos] = useState([]);
  const [uf, setUf] = useState("nenhum");
  const [manual, setManual] = useState("");
  const [importado, setImportado] = useState([]);
  const [passos, setPassos] = useState([{ id: _sid++, type: "text", text: "", file: "" }]);
  const [status, setStatus] = useState({ campaigns: [], counts: {}, officialChannel: null });
  const [canaisWa, setCanaisWa] = useState([]);
  const [canalId, setCanalId] = useState("");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function api(path, action, params = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}${path}`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify(action ? { action, ...params } : params) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }
  async function get(path) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  const carregar = useCallback(async () => {
    const t = await get("/meta-templates");
    if (t.ok) setTemplates((t.data.templates || []).filter((x) => x.status === "APPROVED"));
    else setMsg(t.data.error || "Erro ao listar templates");
    const ct = await supabase.from("contacts").select("external_contact_id,phone,attributes,channels(type)").limit(5000);
    setContatos((ct.data || []).filter((c) => c.channels?.type === "whatsapp" && !(c.attributes || {}).dead));
    const chs = await supabase.from("channels").select("id,name,status,phone_number,display_name,phone_number_id").eq("type", "whatsapp").order("created_at", { ascending: false });
    const lista = (chs.data || []).filter((c) => c.phone_number_id);
    setCanaisWa(lista);
    const s = await api("/campaign", "status");
    if (s.ok) {
      setStatus(s.data);
      const oficial = s.data.officialChannel;
      if (oficial?.id) setCanalId(oficial.id);
      else if (lista.length === 1) setCanalId(lista[0].id);
      else if (lista.length > 0) setCanalId(lista.find((c) => c.status === "active")?.id || lista[0].id);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  const seg = useMemo(() => contatos.map((c) => String(c.phone || c.external_contact_id || "").replace(/\D/g, "")).filter((d) => d.length >= 12).filter((d) => uf !== "nenhum" && (uf === "todos" || ufFromPhone(d) === uf)), [contatos, uf]);
  const publico = useMemo(() => [...new Set([...seg, ...nums(manual), ...importado])], [seg, manual, importado]);
  const ufs = useMemo(() => [...new Set(contatos.map((c) => ufFromPhone(c.phone || c.external_contact_id)).filter(Boolean))].sort(), [contatos]);

  function importar(e) { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setImportado([...new Set(nums(String(r.result)))]); }; r.readAsText(f); }
  function addPasso(type) { setPassos([...passos, { id: _sid++, type, text: "", file: "" }]); }
  function setPasso(id, p) { setPassos(passos.map((x) => x.id === id ? { ...x, ...p } : x)); }
  function rmPasso(id) { setPassos(passos.filter((x) => x.id !== id)); }

  async function disparar() {
    const t = templates.find((x) => x.name === tpl);
    if (!t) return setMsg("Escolha um template aprovado.");
    if (publico.length === 0) return setMsg("Público vazio.");
    if (!canalId) return setMsg("Nenhum número oficial WhatsApp conectado. Vá em Conexões e conecte o canal.");
    const hf = headerFormat(t);
    if (hf && !headerUrl) return setMsg(`Esse template tem cabeçalho de ${hf} — informe a URL da mídia.`);
    if (!confirm(`Disparar template "${tpl}" pra ${publico.length} números? Sequência (${passos.length} passos) sai quando cada um responder.`)) return;
    setEnviando(true);
    setMsg(`Enviando template para ${publico.length} números…`);
    try {
      const params = { name: tpl, template: tpl, language: t.language, numbers: publico, channel_id: canalId, steps: passos.map((p) => ({ type: p.type, text: p.text, file: p.file })) };
      if (hf && headerUrl) params.headerMedia = { format: hf, link: headerUrl };
      const r = await api("/campaign", "start", params);
      if (r.ok) {
        const d = r.data;
        setMsg(`Template enviado pelo ${d.channel?.phone_number || d.channel?.display_name || d.channel?.name || "oficial"}: ${d.sent}/${d.total ?? publico.length} ok, ${d.failed} falha.${d.errors?.length ? " Erros: " + d.errors.join(" | ") : ""} Aguardando respostas pra disparar a sequência.`);
      } else {
        const partial = r.data.partial ? ` (${r.data.sent} enviados antes da falha)` : "";
        setMsg("Erro: " + (r.data.error || JSON.stringify(r.data).slice(0, 150)) + partial);
      }
      carregar();
    } catch (err) {
      setMsg("Falha na rede: " + err.message);
    } finally {
      setEnviando(false);
    }
  }
  function headerFormat(t) {
    const h = (t?.components || []).find((c) => c.type === "HEADER");
    const f = h?.format;
    return f && f !== "TEXT" ? String(f).toLowerCase() : null; // image | video | document
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Campanhas (oficial)</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Template oficial → cliente responde (abre janela) → dispara a sequência. Sem webhook por contato.</div>
        </div>
        {msg && <div className="card" style={{ marginBottom: 16, fontSize: 13, wordBreak: "break-word" }}>{msg}</div>}

        <div className="section-title">Número oficial (remetente)</div>
        <div className="card" style={{ marginBottom: 16 }}>
          {canaisWa.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 13 }}>
              Nenhum WhatsApp oficial conectado. <a href="/conexoes" style={{ color: "var(--mint)" }}>Conectar em Conexões</a>
            </div>
          ) : canaisWa.length === 1 ? (
            <div style={{ fontSize: 14 }}>
              <span className="badge badge-green" style={{ marginRight: 8 }}>Conectado</span>
              {canaisWa[0].name} — {canaisWa[0].phone_number || canaisWa[0].display_name || "—"}
            </div>
          ) : (
            <select value={canalId} onChange={(e) => setCanalId(e.target.value)} style={{ width: "100%" }}>
              <option value="">Escolha o número oficial…</option>
              {canaisWa.map((c) => (
                <option key={c.id} value={c.id}>{c.name} — {c.phone_number || c.display_name || c.id} ({c.status})</option>
              ))}
            </select>
          )}
        </div>

        <div className="section-title">Template aprovado</div>
        <div className="card" style={{ marginBottom: 16 }}>
          {templates.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 13 }}>Nenhum template aprovado (ou bridge sem META_ACCESS_TOKEN).</div> : (
            <select value={tpl} onChange={(e) => setTpl(e.target.value)} style={{ width: "100%" }}>
              <option value="">Escolha…</option>
              {templates.map((t) => <option key={t.name + t.language} value={t.name}>{t.name} [{t.language}] · {t.category}{t.hasMediaHeader ? " · mídia" : ""}</option>)}
            </select>
          )}
        </div>

        <div className="section-title">Público ({publico.length})</div>
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <select value={uf} onChange={(e) => setUf(e.target.value)}>
              <option value="nenhum">Não usar a base</option>
              <option value="todos">Todos da base ({contatos.length})</option>
              {ufs.map((u) => <option key={u} value={u}>{u} — {UF_REGIAO[u]}</option>)}
            </select>
            <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Importar: <input type="file" accept=".txt,.csv" onChange={importar} style={{ fontSize: 13 }} /></label>
            {importado.length > 0 && <span className="badge badge-gray">{importado.length}</span>}
          </div>
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={3} placeholder={"Colar números (um por linha)"} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 10, fontFamily: "inherit" }} />
        </div>

        <div className="section-title">Sequência pós-resposta</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {["text", "image", "video", "audio"].map((t) => <button key={t} className="btn-ghost mini" onClick={() => addPasso(t)}>+ {t}</button>)}
        </div>
        {passos.map((p, i) => (
          <div key={p.id} className="card passo" style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}><span style={{ fontWeight: 600, fontSize: 13 }}>{i + 1}. {p.type}</span><button className="btn-ghost mini" onClick={() => rmPasso(p.id)}>✕</button></div>
            {p.type !== "text" && <input value={p.file} onChange={(e) => setPasso(p.id, { file: e.target.value })} placeholder="URL da mídia" style={{ width: "100%", marginBottom: 6 }} />}
            <textarea value={p.text} onChange={(e) => setPasso(p.id, { text: e.target.value })} rows={2} placeholder={p.type === "text" ? "Mensagem…" : "Legenda (opcional)"} style={{ width: "100%", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 8, padding: 8, fontFamily: "inherit" }} />
          </div>
        ))}

        <button className="btn-mint" onClick={disparar} disabled={enviando} style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
          {enviando ? "Disparando template…" : `Disparar template pra ${publico.length} números`}
        </button>

        <div className="section-title" style={{ marginTop: 28 }}>Campanhas (status)</div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Campanha</th><th>Template</th><th>Aguardando</th><th>Respondeu/ativo</th><th>Concluído</th></tr></thead>
            <tbody>
              {status.campaigns.length === 0 ? <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhuma campanha</td></tr> :
                status.campaigns.map((c) => { const k = status.counts[c.id] || {}; return (
                  <tr key={c.id}><td>{c.name}</td><td>{c.template} [{c.language}]</td><td>{k.awaiting || 0}</td><td>{k.active || 0}</td><td>{k.done || 0}</td></tr>
                ); })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>
          "Aguardando" = template enviado, esperando o cliente responder. Quando responde, a sequência dispara e vai pra "Concluído".
        </div>
      </div>
    </>
  );
}
