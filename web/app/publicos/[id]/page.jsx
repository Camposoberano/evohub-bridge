"use client";
// Tabela nomeada com edição auditável, cabeçalhos estáveis e busca paginada.
// Portado do hub CECAPE. (Verificação de WhatsApp — verify-batch — fica para uma fase futura.)
import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { exportAudienceCsv } from "@/lib/audience-export.mjs";

function normFone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

export default function PublicoTabela() {
  const router = useRouter();
  const { id } = useParams();
  const [pronto, setPronto] = useState(false);
  const [aud, setAud] = useState(null);
  const [cols, setCols] = useState([]);      // {id,title,key,ordinal,active}
  const [rows, setRows] = useState([]);      // {phone, name, attributes}
  const [savedRows, setSavedRows] = useState({});
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(0);
  const [ordem, setOrdem] = useState("name");
  const [desc, setDesc] = useState(false);
  const [historico, setHistorico] = useState(null);
  const [editandoColuna, setEditandoColuna] = useState(null);
  const [busca, setBusca] = useState("");
  const [novaCol, setNovaCol] = useState("");
  const [nova, setNova] = useState({ phone: "", name: "", attributes: {} });
  const [msg, setMsg] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [verifyChannels, setVerifyChannels] = useState([]);
  const [verifyChannelId, setVerifyChannelId] = useState("");
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyProgress, setVerifyProgress] = useState(0);
  const [verifySummary, setVerifySummary] = useState(null);

  async function authH() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" };
  }
  async function post(payload) {
    const h = await authH();
    return fetch(`${BRIDGE_URL}/audiences`, { method: "POST", headers: h, body: JSON.stringify(payload) }).then((r) => r.json()).catch(() => ({ error: "falha de rede" }));
  }

  const carregar = useCallback(async () => {
    const h = await authH();
    const p = new URLSearchParams({ id: String(id), limit: "50", offset: String(pagina * 50), q: busca, sort: ordem, desc: desc ? "1" : "0" });
    if (verifyChannelId) p.set("verification_channel_id", verifyChannelId);
    const b = await fetch(`${BRIDGE_URL}/audiences?${p}`, { headers: h }).then((r) => r.json()).catch(() => ({}));
    if (b.error || !b.audience) { setMsg(b.error || "público não encontrado"); return; }
    setAud(b.audience);
    setCols((b.audience.column_schema ?? []).filter((c) => c.active !== false).sort((a, z) => a.ordinal - z.ordinal));
    const next = (b.contacts ?? []).map((c) => ({ phone: c.phone, name: c.name ?? "", attributes: c.attributes ?? {}, verification: c.verification ?? null }));
    setRows(next);
    setSavedRows(Object.fromEntries(next.map((row) => [row.phone, structuredClone(row)])));
    setTotal(b.total ?? next.length);
  }, [id, pagina, busca, ordem, desc, verifyChannelId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  async function salvarCabecalho(campos) {
    const r = await post({ action: "update", id, ...campos });
    if (r.error) setMsg(`erro: ${r.error}`);
    else { setAud((a) => ({ ...a, ...campos })); setMsg("✅ salvo"); }
  }
  async function addColuna() {
    const nome = novaCol.trim();
    if (!nome) return;
    const r = await post({ action: "add-column", id, title: nome });
    if (r.error) { setMsg(`erro: ${r.error}`); return; }
    setNovaCol(""); setCols(r.column_schema.filter((c) => c.active !== false));
    setAud((a) => ({ ...a, schema_version: r.schema_version })); setMsg("Coluna adicionada.");
  }
  async function removerColuna(c) {
    if (!confirm(`Ocultar a coluna "${c.title}"? Seus valores serão preservados.`)) return;
    const r = await post({ action: "remove-column", id, column_id: c.id });
    if (r.error) { setMsg(`erro: ${r.error}`); return; }
    setCols(r.column_schema.filter((x) => x.active !== false)); setMsg("Coluna ocultada; valores preservados.");
  }
  async function renomearColuna(c) {
    const titulo = editandoColuna?.title?.trim();
    if (!titulo || titulo === c.title) { setEditandoColuna(null); return; }
    const r = await post({ action: "rename-column", id, column_id: c.id, title: titulo });
    if (r.error) { setMsg(`erro: ${r.error}`); return; }
    setCols(r.column_schema.filter((x) => x.active !== false)); setEditandoColuna(null); setMsg("Cabeçalho salvo.");
  }

  // Salva a linha inteira de modo atômico, com histórico por campo no banco.
  async function salvarLinha(row) {
    const fone = normFone(row.phone);
    if (!fone) return;
    if (row.name.includes("�") || Object.values(row.attributes).some((v) => String(v).includes("�"))) {
      setMsg("erro: há caracteres � nesta linha; confira o valor original antes de salvar"); return;
    }
    const r = await post({ action: "set-contact", id, phone: fone, name: row.name, attributes: row.attributes });
    if (r.error) setMsg(`erro: ${r.error}`);
    else { setMsg("Linha salva."); setSavedRows((old) => ({ ...old, [fone]: structuredClone(row) })); }
    if (r.count !== undefined) setAud((a) => ({ ...a, contact_count: r.count }));
  }
  function editarCelula(i, campo, valor) {
    setRows((rs) => rs.map((r, j) => {
      if (j !== i) return r;
      if (campo === "name") return { ...r, name: valor };
      return { ...r, attributes: { ...r.attributes, [campo]: valor } };
    }));
  }
  function cancelarLinha(phone) {
    const original = savedRows[phone];
    if (original) setRows((rs) => rs.map((r) => r.phone === phone ? structuredClone(original) : r));
  }
  async function abrirHistorico(phone) {
    const h = await authH();
    const p = new URLSearchParams({ id: String(id), history_phone: phone });
    const b = await fetch(`${BRIDGE_URL}/audiences?${p}`, { headers: h }).then((r) => r.json()).catch(() => ({ error: "falha de rede" }));
    if (b.error) { setMsg(`erro: ${b.error}`); return; }
    setHistorico({ phone, entries: b.history ?? [] });
  }
  async function removerLinha(phone) {
    const r = await post({ action: "remove-contact", id, phone });
    if (r.error) { setMsg(`erro: ${r.error}`); return; }
    setRows((rs) => rs.filter((x) => x.phone !== phone)); setTotal((n) => Math.max(0, n - 1));
    if (r.count !== undefined) setAud((a) => ({ ...a, contact_count: r.count }));
  }
  async function adicionarPessoa() {
    const fone = normFone(nova.phone);
    if (!fone) { setMsg("telefone inválido"); return; }
    const r = await post({ action: "set-contact", id, phone: fone, name: nova.name, attributes: nova.attributes });
    if (r.error) { setMsg(`erro: ${r.error}`); return; }
    setNova({ phone: "", name: "", attributes: {} });
    carregar();
  }

  // Canais WhatsApp ativos para a verificação (lê direto via RLS, igual à página de fluxos).
  useEffect(() => {
    if (!pronto) return;
    supabase.from("channels").select("id,name,phone_number,external_id")
      .eq("type", "whatsapp").eq("status", "active").order("name")
      .then(({ data }) => setVerifyChannels((data ?? []).filter((c) => c.external_id)))
      .catch(() => setVerifyChannels([]));
  }, [pronto]);

  useEffect(() => {
    if (!pronto || !verifyChannelId) { setVerifySummary(null); return; }
    authH().then((h) => fetch(`${BRIDGE_URL}/audiences?id=${encodeURIComponent(String(id))}&verification_summary_channel_id=${encodeURIComponent(verifyChannelId)}`, { headers: h }))
      .then((r) => r.json()).then((data) => setVerifySummary(data.verification_summary ?? null))
      .catch(() => setVerifySummary(null));
  }, [id, pronto, verifyChannelId]);

  async function verificarPublico(refresh = false) {
    if (!verifyChannelId || verifyBusy) return;
    setVerifyBusy(true); setVerifyProgress(0); setMsg("");
    let after = "";
    let checked = 0;
    const counts = { confirmed: 0, not_found: 0, unconfirmed: 0 };
    try {
      for (;;) {
        const result = await post({ action: "verify-batch", id, channel_id: verifyChannelId, after_phone: after, refresh: refresh === true });
        if (!result.ok) throw new Error(result.error ?? "consulta falhou");
        checked += Number(result.checked ?? 0);
        counts.confirmed += Number(result.confirmed ?? 0);
        counts.not_found += Number(result.not_found ?? 0);
        counts.unconfirmed += Number(result.unconfirmed ?? 0);
        setVerifyProgress(checked);
        if (result.paused) { setMsg("A consulta do WhatsApp ficou indisponível. Os resultados anteriores foram salvos; clique em Continuar verificação mais tarde."); break; }
        if (result.done) break;
        if (!result.after_phone || result.after_phone === after) throw new Error("verificação sem avanço");
        after = result.after_phone;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      setVerifySummary(counts);
      if (!counts.unconfirmed) setMsg(`Verificados ${checked} número(s). Nenhuma mensagem foi enviada.`);
      await carregar();
    } catch (error) { setMsg(`erro: ${error.message}`); }
    finally { setVerifyBusy(false); }
  }

  async function exportarCsv() {
    if (exportBusy) return;
    setExportBusy(true); setMsg("");
    try {
      const h = await authH();
      const all = [];
      for (let offset = 0;; offset += 100) {
        const p = new URLSearchParams({ id: String(id), limit: "100", offset: String(offset), sort: "phone" });
        if (verifyChannelId) p.set("verification_channel_id", verifyChannelId);
        const res = await fetch(`${BRIDGE_URL}/audiences?${p}`, { headers: h });
        const page = await res.json();
        if (!res.ok || page.error) throw new Error(page.error ?? "consulta falhou");
        all.push(...(page.contacts ?? []));
        if ((page.contacts ?? []).length < 100) break;
      }
      const blob = new Blob([exportAudienceCsv(all, cols)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url;
      a.download = `${String(aud.name ?? "publico").replace(/[^a-z0-9_-]+/gi, "_")}.csv`;
      a.click(); URL.revokeObjectURL(url);
      setMsg(`CSV exportado: ${all.length} contato(s).`);
    } catch (error) { setMsg(`erro: ${error.message}`); }
    finally { setExportBusy(false); }
  }

  if (!pronto) return null;
  if (!aud) return (<><Nav /><div style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>{msg || "Carregando…"} <Link href="/publicos">← voltar</Link></div></>);

  const th = { textAlign: "left", fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".05em", padding: "8px 8px", whiteSpace: "nowrap" };
  const cell = { padding: "3px 4px", borderTop: "1px solid var(--border-soft)" };
  const cin = { width: "100%", fontSize: 13, padding: "6px 8px", borderRadius: 7, border: "1px solid transparent", background: "transparent" };

  return (
    <>
      <Nav />
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 16px 60px" }}>
        <Link href="/publicos" style={{ fontSize: 13, color: "var(--text-faint)" }}>← Públicos</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "8px 0 14px" }}>
          <input value={aud.name} onChange={(e) => setAud({ ...aud, name: e.target.value })} onBlur={() => salvarCabecalho({ name: aud.name })}
            style={{ fontSize: 20, fontWeight: 800, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--border-soft)", flex: "1 1 240px" }} />
          <input value={aud.tag ?? ""} onChange={(e) => setAud({ ...aud, tag: e.target.value })} onBlur={() => salvarCabecalho({ tag: aud.tag ?? "" })}
            placeholder="etiqueta" style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, width: 160 }} />
          <span style={{ fontSize: 13, color: "var(--text-faint)" }}>{aud.contact_count} contato(s)</span>
          <button className="btn-ghost mini" onClick={exportarCsv} disabled={exportBusy}>{exportBusy ? "Exportando…" : "Exportar CSV"}</button>
        </div>

        <div className="card" style={{ padding: 16, marginBottom: 12 }}>
          <strong>Verificar números do público</strong>
          <p style={{ fontSize: 13, color: "var(--text-faint)", margin: "6px 0 10px" }}>
            Consulta o WhatsApp sem enviar mensagens. “Confirmado” indica presença no momento da consulta; entrega e leitura dependem dos recibos.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <select value={verifyChannelId} onChange={(e) => setVerifyChannelId(e.target.value)} disabled={verifyBusy}>
              <option value="">Escolha uma instância conectada</option>
              {verifyChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
            </select>
            <button className="btn-ghost mini" onClick={() => verificarPublico()} disabled={!verifyChannelId || verifyBusy}>
              {verifyBusy ? `Verificando… ${verifyProgress}` : "Continuar verificação"}
            </button>
            <button className="btn-ghost mini" onClick={() => verificarPublico(true)} disabled={!verifyChannelId || verifyBusy}>Reverificar todos</button>
          </div>
          {verifySummary && <p style={{ fontSize: 13, margin: "10px 0 0" }}>
            Confirmados: {verifySummary.confirmed} · Não encontrados: {verifySummary.not_found} ·
            Não confirmados: {verifySummary.unconfirmed} · Ainda não verificados: {Math.max(0, (aud.contact_count ?? total) - verifySummary.confirmed - verifySummary.not_found - verifySummary.unconfirmed)}
          </p>}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <input value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} placeholder="Buscar em nomes, telefones e colunas…" aria-label="Buscar contatos" style={{ fontSize: 13, padding: "7px 10px", borderRadius: 9, flex: "1 1 200px" }} />
          <input value={novaCol} onChange={(e) => setNovaCol(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addColuna()} placeholder="Nova coluna" aria-label="Título da nova coluna" style={{ fontSize: 13, padding: "7px 10px", borderRadius: 9, width: 180 }} />
          <button className="btn-ghost mini" onClick={addColuna}>+ coluna</button>
          <button className="btn-ghost mini" onClick={carregar}>Atualizar</button>
          {msg && <span style={{ fontSize: 12, color: msg.startsWith("erro") ? "var(--red)" : "var(--text-faint)", alignSelf: "center" }}>{msg}</span>}
        </div>

        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", maxHeight: 560, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
              <thead><tr style={{ position: "sticky", top: 0, background: "var(--surface)" }}>
                <th style={th}><button className="btn-ghost mini" onClick={() => { setOrdem("name"); setDesc((v) => ordem === "name" ? !v : false); setPagina(0); }}>Nome {ordem === "name" ? desc ? "↓" : "↑" : ""}</button></th>
                <th style={th}><button className="btn-ghost mini" onClick={() => { setOrdem("phone"); setDesc((v) => ordem === "phone" ? !v : false); setPagina(0); }}>Telefone {ordem === "phone" ? desc ? "↓" : "↑" : ""}</button></th>
                {cols.map((c) => (
                  <th key={c.id} style={th}>
                    {editandoColuna?.id === c.id ? <span><input autoFocus aria-label="Novo cabeçalho" value={editandoColuna.title} onChange={(e) => setEditandoColuna({ id: c.id, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && renomearColuna(c)} style={{ width: 130 }} /><button className="btn-ghost mini" onClick={() => renomearColuna(c)}>Salvar</button><button className="btn-ghost mini" onClick={() => setEditandoColuna(null)}>Cancelar</button></span> : <span>{c.title} <button className="btn-ghost mini" onClick={() => setEditandoColuna({ id: c.id, title: c.title })} title={`Renomear ${c.title}`}>Editar</button><button className="btn-ghost mini" onClick={() => removerColuna(c)} title={`Ocultar ${c.title}`}>×</button></span>}
                  </th>
                ))}
                <th style={th}>WhatsApp</th>
                <th style={th}>Ações</th>
              </tr></thead>
              <tbody>
                {/* adicionar pessoa */}
                <tr style={{ background: "var(--surface-2)" }}>
                  <td style={cell}><input value={nova.name} onChange={(e) => setNova({ ...nova, name: e.target.value })} placeholder="novo nome" style={cin} /></td>
                  <td style={cell}><input value={nova.phone} onChange={(e) => setNova({ ...nova, phone: e.target.value })} onKeyDown={(e) => e.key === "Enter" && adicionarPessoa()} placeholder="telefone" style={cin} /></td>
                  {cols.map((c) => (<td key={c.id} style={cell}><input aria-label={`${c.title} da nova pessoa`} value={nova.attributes[c.key] ?? ""} onChange={(e) => setNova({ ...nova, attributes: { ...nova.attributes, [c.key]: e.target.value } })} style={cin} /></td>))}
                  <td style={cell}>—</td>
                  <td style={cell}><button className="btn-ghost mini" onClick={adicionarPessoa} title="Adicionar">+</button></td>
                </tr>
                {rows.map((r) => {
                  const i = rows.indexOf(r);
                  const sujo = JSON.stringify(r) !== JSON.stringify(savedRows[r.phone]);
                  const temErroTexto = r.name.includes("�") || Object.values(r.attributes ?? {}).some((v) => String(v).includes("�"));
                  return (
                    <tr key={r.phone} style={{ background: temErroTexto ? "#fff4f2" : undefined }}>
                      <td style={cell}><input aria-label={`Nome de ${r.phone}`} value={r.name} onChange={(e) => editarCelula(i, "name", e.target.value)} style={cin} />{temErroTexto && <small style={{ color: "var(--red)", display: "block" }}>Texto com �; conferir original</small>}</td>
                      <td style={{ ...cell, color: "var(--text-faint)", fontSize: 13, padding: "6px 8px" }}>{r.phone}</td>
                      {cols.map((c) => (<td key={c.id} style={cell}><input aria-label={`${c.title} de ${r.phone}`} value={r.attributes?.[c.key] ?? r.attributes?.[c.legacy_title] ?? ""} onChange={(e) => editarCelula(i, c.key, e.target.value)} style={cin} /></td>))}
                      <td style={{ ...cell, fontSize: 12 }}>{r.verification?.status === "confirmed" ? "Confirmado" : r.verification?.status === "not_found" ? "Não encontrado" : r.verification?.status === "unconfirmed" ? "Não confirmado" : "Não verificado"}</td>
                      <td style={cell}><div style={{ display: "flex", gap: 4 }}><button className="btn-ghost mini" disabled={!sujo || temErroTexto} onClick={() => salvarLinha(r)}>Salvar</button><button className="btn-ghost mini" disabled={!sujo} onClick={() => cancelarLinha(r.phone)}>Cancelar</button><button className="btn-ghost mini" onClick={() => abrirHistorico(r.phone)}>Histórico</button><button className="btn-ghost mini" style={{ color: "var(--red)" }} onClick={() => removerLinha(r.phone)} title="Remover">×</button></div></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-faint)" }}>
          Mostrando {rows.length ? pagina * 50 + 1 : 0}–{pagina * 50 + rows.length} de {total}. Telefone é a chave da linha. Colunas ocultadas preservam os valores existentes.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button className="btn-ghost mini" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</button><button className="btn-ghost mini" disabled={(pagina + 1) * 50 >= total} onClick={() => setPagina((p) => p + 1)}>Próxima</button></div>
        {historico && <section className="card" style={{ marginTop: 16, padding: 16 }} aria-label="Histórico de alterações"><div style={{ display: "flex", justifyContent: "space-between" }}><h3>Histórico · {historico.phone}</h3><button className="btn-ghost mini" onClick={() => setHistorico(null)}>Fechar</button></div>{historico.entries.length ? <ul>{historico.entries.map((entry, i) => <li key={i}>{new Date(entry.changed_at).toLocaleString("pt-BR")}: {entry.field_key} · {entry.old_value ?? "(vazio)"} → {entry.new_value ?? "(vazio)"}</li>)}</ul> : <p>Sem alterações registradas após a ativação do histórico.</p>}</section>}
      </div>
    </>
  );
}
