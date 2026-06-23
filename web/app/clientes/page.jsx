"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import { UF_REGIAO } from "@/lib/ddd";
import Nav from "@/components/Nav";

export default function Clientes() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [wa, setWa] = useState(false);
  const [busca, setBusca] = useState(""); // termo aplicado (debounce manual via Enter)
  const [fUf, setFUf] = useState("todos");
  const [selecionados, setSelecionados] = useState(new Set()); // telefones marcados (persiste entre páginas)
  const [ficha, setFicha] = useState(null); // dado completo do modal
  const [carregandoFicha, setCarregandoFicha] = useState(false);
  const [msg, setMsg] = useState("");
  const limit = 50;

  async function get(path) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  function paramsAtuais() {
    const params = new URLSearchParams();
    if (busca) params.set("q", busca);
    if (wa) params.set("wa", "1");
    if (fUf !== "todos") params.set("uf", fUf);
    return params;
  }

  const carregar = useCallback(async () => {
    const params = paramsAtuais();
    params.set("page", String(page));
    params.set("limit", String(limit));
    const r = await get(`/clientes?${params}`);
    if (r.ok) { setRows(r.data.clientes || []); setTotal(r.data.total || 0); }
    const s = await get("/clientes?stats=1");
    if (s.ok) setStats(s.data);
  }, [page, busca, wa, fUf]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
    });
  }, [router]);
  useEffect(() => { if (pronto) carregar(); }, [pronto, carregar]);

  // UF já vem calculada do backend (escaneia a base toda, não só a página atual). Sem limite --
  // o Brasil tem 27 estados, não custa nada mostrar todos os que aparecerem.
  const porUf = stats?.por_uf ?? [];
  const pages = Math.ceil(total / limit) || 1;
  const todaPaginaMarcada = rows.length > 0 && rows.every((c) => selecionados.has(c.phone));

  function toggleUm(phone) {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (novo.has(phone)) novo.delete(phone); else novo.add(phone);
      return novo;
    });
  }
  function toggleTodaPagina() {
    setSelecionados((s) => {
      const novo = new Set(s);
      if (todaPaginaMarcada) rows.forEach((c) => novo.delete(c.phone));
      else rows.forEach((c) => novo.add(c.phone));
      return novo;
    });
  }
  async function selecionarTodosFiltrados() {
    const params = paramsAtuais();
    params.set("allphones", "1");
    setMsg("Buscando todos os filtrados…");
    const r = await get(`/clientes?${params}`);
    if (r.ok) {
      setSelecionados(new Set(r.data.phones || []));
      setMsg(`${(r.data.phones || []).length} selecionados.`);
    } else setMsg("Erro ao buscar.");
  }
  function limparSelecao() { setSelecionados(new Set()); setMsg(""); }

  function enviarPara(destino) {
    if (selecionados.size === 0) { setMsg("Nenhum selecionado."); return; }
    sessionStorage.setItem("soberano:importado-numeros", JSON.stringify([...selecionados]));
    router.push(destino);
  }

  async function abrirFicha(phone) {
    setCarregandoFicha(true);
    setFicha({ phone }); // abre o modal já, preenche quando a resposta chegar
    const r = await get(`/clientes?phone=${encodeURIComponent(phone)}`);
    setCarregandoFicha(false);
    if (r.ok) setFicha(r.data); else { setFicha(null); setMsg("Erro ao carregar ficha."); }
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Clientes</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Base de contatos importada + enriquecida pelo WhatsApp.</div>
        </div>

        <div className="stat-grid" style={{ marginBottom: 18 }}>
          {[["Total", stats?.total], ["Com WhatsApp", stats?.on_whatsapp], ["Enriquecidos", stats?.enriquecidos], ["Pendentes", stats?.pendentes]].map(([l, v]) => (
            <div key={l} className="stat-card"><div className="stat-label">{l}</div><div className="stat-value">{v ?? "—"}</div></div>
          ))}
        </div>

        {porUf.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            <span style={{ fontSize: 12, color: "var(--text-faint)", alignSelf: "center" }}>Com WhatsApp por estado ({porUf.length}):</span>
            {porUf.map(({ uf, count }) => (
              <button key={uf} className={"tab" + (fUf === uf ? " tab-active" : "")} onClick={() => { setFUf(fUf === uf ? "todos" : uf); setPage(1); }}>
                {uf} <span style={{ color: "var(--text-faint)" }}>{count}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setBusca(q); } }}
            placeholder="Buscar nome ou número… (Enter)" style={{ flex: 1, minWidth: 220 }} />
          <label style={{ fontSize: 13, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={wa} onChange={(e) => { setWa(e.target.checked); setPage(1); }} style={{ width: "auto" }} /> Só com WhatsApp
          </label>
          {fUf !== "todos" && <span className="badge badge-gray">Estado: {fUf} — {UF_REGIAO[fUf]} <button className="btn-ghost mini" style={{ marginLeft: 6 }} onClick={() => { setFUf("todos"); setPage(1); }}>✕</button></span>}
          <button className="btn-ghost mini" onClick={() => { setPage(1); setBusca(q); }}>Buscar</button>
        </div>

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center", background: "var(--surface-2)", padding: 10, borderRadius: 10 }}>
          <span className="badge badge-gray">{selecionados.size} selecionado(s)</span>
          <button className="btn-ghost mini" onClick={selecionarTodosFiltrados}>Selecionar todos os {total} filtrados</button>
          <button className="btn-ghost mini" onClick={limparSelecao}>Limpar seleção</button>
          <span style={{ flex: 1 }} />
          <button className="btn-mint mini" onClick={() => enviarPara("/disparos")}>Enviar pra Disparos</button>
          <button className="btn-mint mini" onClick={() => enviarPara("/campanhas")}>Enviar pra Campanhas</button>
        </div>
        {msg && <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>{msg}</div>}

        <div className="table-wrap">
          <table className="table">
            <thead><tr>
              <th><input type="checkbox" checked={todaPaginaMarcada} onChange={toggleTodaPagina} /></th>
              <th></th><th>Nome</th><th>Número</th><th>Estado</th><th>WhatsApp</th><th>Já é contato</th><th>Origem</th><th>Grupos</th><th>Status</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhum cliente</td></tr> :
                rows.map((c) => (
                  <tr key={c.phone} style={{ cursor: "pointer" }} onClick={(e) => { if (e.target.type !== "checkbox") abrirFicha(c.phone); }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selecionados.has(c.phone)} onChange={() => toggleUm(c.phone)} /></td>
                    <td style={{ width: 40 }}>{c.image_preview ? <img src={c.image_preview} alt="" style={{ width: 30, height: 30, borderRadius: 999, objectFit: "cover" }} /> : <span style={{ width: 30, height: 30, borderRadius: 999, background: "var(--surface-2)", display: "inline-block" }} />}</td>
                    <td>{c.wa_name || c.wa_contact_name || c.verified_name || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.phone}</td>
                    <td>{c.uf ? <span className="badge badge-gray">{c.uf}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td>{c.on_whatsapp === true ? <span className="badge badge-green">sim</span> : c.on_whatsapp === false ? <span className="badge badge-red">não</span> : <span className="badge badge-gray">?</span>}</td>
                    <td>{c.is_contact ? <span className="badge badge-amber">sim — já conversou</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td style={{ fontSize: 12, color: "var(--text-dim)" }}>{c.source_number}</td>
                    <td>{c.common_groups ?? "—"}</td>
                    <td><span className="badge badge-gray">{c.enrich_status}</span></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--text-dim)" }}>
          <span>{total} clientes</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn-ghost mini" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
            página {page}/{pages}
            <button className="btn-ghost mini" disabled={page >= pages} onClick={() => setPage(page + 1)}>→</button>
          </span>
        </div>
      </div>

      {ficha && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }} onClick={() => setFicha(null)}>
          <div className="card" style={{ width: 420, maxHeight: "80vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
            {carregandoFicha ? <div style={{ padding: 20, color: "var(--text-dim)" }}>Carregando…</div> : (
              <>
                <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
                  {ficha.image_url || ficha.image_preview ? (
                    <img src={ficha.image_url || ficha.image_preview} alt="" style={{ width: 56, height: 56, borderRadius: 999, objectFit: "cover" }} />
                  ) : <span style={{ width: 56, height: 56, borderRadius: 999, background: "var(--surface-2)", display: "inline-block" }} />}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{ficha.wa_name || ficha.wa_contact_name || ficha.verified_name || "Sem nome"}</div>
                    <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{ficha.phone}</div>
                  </div>
                  <button className="btn-ghost mini" style={{ marginLeft: "auto" }} onClick={() => setFicha(null)}>✕</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
                  <Campo l="Estado" v={ficha.uf ? `${ficha.uf} — ${UF_REGIAO[ficha.uf] ?? ""}` : "—"} />
                  <Campo l="No WhatsApp" v={ficha.on_whatsapp === true ? "sim" : ficha.on_whatsapp === false ? "não" : "?"} />
                  <Campo l="Já é contato" v={ficha.is_contact ? "sim — já conversou" : "não"} />
                  <Campo l="Status enriquecimento" v={ficha.enrich_status ?? "—"} />
                  <Campo l="Origem (lista)" v={ficha.source_number ?? "—"} />
                  <Campo l="Grupos em comum" v={ficha.common_groups ?? "—"} />
                  <Campo l="Nome verificado" v={ficha.verified_name ?? "—"} />
                  <Campo l="Nome de contato (agenda)" v={ficha.wa_contact_name ?? "—"} />
                  <Campo l="Lead / tags" v={ficha.lead_tags || ficha.lead_name ? `${ficha.lead_name ?? ""} ${ficha.lead_tags ?? ""}`.trim() : "—"} />
                  <Campo l="Etiquetas (uazapi)" v={ficha.labels ?? "—"} />
                  <Campo l="JID" v={ficha.jid ?? "—"} />
                  <Campo l="LID" v={ficha.lid ?? "—"} />
                </div>
                {ficha.contato && (
                  <div style={{ marginTop: 14, padding: 10, background: "var(--surface-2)", borderRadius: 8, fontSize: 13 }}>
                    Já tem conversa real como contato: <b>{ficha.contato.name || ficha.contato.phone}</b> — último contato em {ficha.contato.last_seen_at ? new Date(ficha.contato.last_seen_at).toLocaleString("pt-BR") : "—"}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Campo({ l, v }) {
  return (
    <div>
      <div style={{ color: "var(--text-faint)", fontSize: 11 }}>{l}</div>
      <div>{v}</div>
    </div>
  );
}
