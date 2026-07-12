"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ufFromPhone, regiaoFromPhone, UF_REGIAO } from "@/lib/ddd";
import Nav from "@/components/Nav";

const PLAT = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram" };
const DAY = 86_400_000;
const ORDEM_REGIOES = ["Sul", "Sudeste", "Centro-Oeste", "Norte", "Nordeste"];

function quando(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
// Janela 24h: aberta se último contato do cliente < 24h.
function janela(lastSeen) {
  if (!lastSeen) return null;
  return (Date.now() - Date.parse(lastSeen)) < DAY;
}

export default function Contatos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [contatos, setContatos] = useState([]);
  const [convCount, setConvCount] = useState({});
  const [busca, setBusca] = useState("");
  const [fUf, setFUf] = useState("todos");
  const [fJanela, setFJanela] = useState("todos");
  const [fMorto, setFMorto] = useState("vivos");
  const [regiaoAberta, setRegiaoAberta] = useState(null);
  const [clienteGlobalCount, setClienteGlobalCount] = useState({});

  const carregar = useCallback(async () => {
    const [ct, cv] = await Promise.all([
      supabase.from("contacts").select("*, channels(name,type), customers(id,display_name,canonical_phone,avatar_url)").order("last_seen_at", { ascending: false }).limit(2000),
      supabase.from("conversations").select("contact_id"),
    ]);
    setContatos(ct.data || []);
    const m = {};
    for (const r of cv.data || []) m[r.contact_id] = (m[r.contact_id] || 0) + 1;
    setConvCount(m);
    const globals = {};
    for (const c of ct.data || []) {
      if (c.customer_id) globals[c.customer_id] = (globals[c.customer_id] || 0) + 1;
    }
    setClienteGlobalCount(globals);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  // mapa telefone(normalizado) -> nº de registros (mesma pessoa em 2 números/canais)
  const foneCount = useMemo(() => {
    const m = {};
    for (const c of contatos) {
      const d = String(c.phone || c.external_contact_id || "").replace(/\D/g, "");
      if (d.length >= 10) m[d] = (m[d] || 0) + 1;
    }
    return m;
  }, [contatos]);

  // enriquece com UF/região derivados do telefone
  const enriquecidos = useMemo(() => contatos.map((c) => {
    const fone = c.phone || c.external_contact_id;
    const uf = c.channels?.type === "whatsapp" ? ufFromPhone(fone) : null;
    const d = String(fone || "").replace(/\D/g, "");
    return {
      ...c, uf,
      regiao: uf ? UF_REGIAO[uf] : (c.channels?.type === "whatsapp" ? regiaoFromPhone(fone) : null),
      janelaAberta: janela(c.last_seen_at),
      dead: Boolean((c.attributes || {}).dead),
      multiNum: d.length >= 10 && foneCount[d] > 1,
    };
  }), [contatos, foneCount]);

  const ufsPresentes = useMemo(() => {
    const s = new Set(enriquecidos.map((c) => c.uf).filter(Boolean));
    return [...s].sort();
  }, [enriquecidos]);

  const filtrados = enriquecidos.filter((c) => {
    const s = busca.toLowerCase();
    const globalName = c.customers?.display_name || "";
    const txtOk = (c.name || "").toLowerCase().includes(s) || globalName.toLowerCase().includes(s) || (c.phone || "").includes(s) || (c.external_contact_id || "").includes(s);
    if (!txtOk) return false;
    if (fUf !== "todos" && c.uf !== fUf) return false;
    if (fJanela === "aberta" && !c.janelaAberta) return false;
    if (fJanela === "fechada" && c.janelaAberta) return false;
    if (fMorto === "vivos" && c.dead) return false;
    if (fMorto === "mortos" && !c.dead) return false;
    return true;
  });

  // resumo por estado (pra campanha por região)
  const porUf = useMemo(() => {
    const m = {};
    for (const c of enriquecidos) if (c.uf) m[c.uf] = (m[c.uf] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([uf, count]) => ({ uf, count }));
  }, [enriquecidos]);

  // agrupa por região (5 botões) -- igual feito em Clientes, menos poluído que listar 27 estados.
  const porRegiao = useMemo(() => {
    const m = new Map(ORDEM_REGIOES.map((r) => [r, { estados: [], total: 0 }]));
    for (const p of porUf) {
      const reg = UF_REGIAO[p.uf];
      const g = m.get(reg);
      if (g) { g.estados.push(p); g.total += p.count; }
    }
    return ORDEM_REGIOES.map((reg) => ({ reg, ...m.get(reg) }));
  }, [porUf]);

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 18 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Contatos</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Requalificação por estado (DDD) e janela de 24h
          </div>
        </div>

        {porUf.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: regiaoAberta ? 8 : 0 }}>
              <span style={{ fontSize: 12, color: "var(--text-faint)", alignSelf: "center" }}>Por região:</span>
              {porRegiao.filter((r) => r.total > 0).map(({ reg, total: t }) => (
                <button key={reg} className={"tab" + (regiaoAberta === reg ? " tab-active" : "")} onClick={() => setRegiaoAberta(regiaoAberta === reg ? null : reg)}>
                  {reg} <span style={{ color: "var(--text-faint)" }}>{t}</span>
                </button>
              ))}
            </div>
            {regiaoAberta && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingLeft: 16 }}>
                {porRegiao.find((r) => r.reg === regiaoAberta)?.estados.map(({ uf, count }) => (
                  <button key={uf} className={"tab" + (fUf === uf ? " tab-active" : "")} onClick={() => setFUf(fUf === uf ? "todos" : uf)}>
                    {uf} <span style={{ color: "var(--text-faint)" }}>{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome, telefone..." style={{ flex: 1, minWidth: 180 }} />
          <select value={fUf} onChange={(e) => setFUf(e.target.value)}>
            <option value="todos">Todos estados</option>
            {ufsPresentes.map((uf) => <option key={uf} value={uf}>{uf} — {UF_REGIAO[uf]}</option>)}
          </select>
          <select value={fJanela} onChange={(e) => setFJanela(e.target.value)}>
            <option value="todos">Qualquer janela</option>
            <option value="aberta">Janela aberta (24h)</option>
            <option value="fechada">Janela fechada</option>
          </select>
          <select value={fMorto} onChange={(e) => setFMorto(e.target.value)}>
            <option value="vivos">Só ativos</option>
            <option value="todos">Incluir mortos</option>
            <option value="mortos">Só números mortos</option>
          </select>
          <span className="badge badge-gray">{filtrados.length}</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Cliente global</th><th>Contato no canal</th><th>Canal</th><th>Telefone</th><th>Estado</th><th>Janela 24h</th><th>Conversas</th><th>Último contato</th></tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)", padding: 30 }}>Nenhum contato</td></tr>
              ) : filtrados.slice(0, 500).map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.customers?.avatar_url && <img src={c.customers.avatar_url} alt="" style={{ width: 26, height: 26, borderRadius: 999, objectFit: "cover", verticalAlign: "middle", marginRight: 7 }} />}
                    {c.customers?.display_name || <span style={{ color: "var(--text-faint)" }}>Cliente sem nome</span>}
                    <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{c.customer_id ? `${clienteGlobalCount[c.customer_id] || 1} canal(is) relacionado(s)` : "sem identidade global"}</div>
                  </td>
                  <td>
                    {c.name || <span style={{ color: "var(--text-faint)" }}>{c.external_contact_id}</span>}
                    {c.dead && <span className="badge badge-red" style={{ marginLeft: 6, fontSize: 10 }}>morto</span>}
                    {c.multiNum && <span className="badge badge-amber" style={{ marginLeft: 6, fontSize: 10 }}>2+ núm.</span>}
                  </td>
                  <td>{PLAT[c.channels?.type] || c.channels?.type || "—"}<div style={{ fontSize: 12, color: "var(--text-faint)" }}>{c.channels?.name}</div></td>
                  <td style={{ fontSize: 13 }}>{c.phone || "—"}</td>
                  <td>{c.uf ? <span className="badge badge-gray">{c.uf}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}{c.regiao && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{c.regiao}</div>}</td>
                  <td>{c.janelaAberta === null ? "—" : <span className={"badge " + (c.janelaAberta ? "badge-green" : "badge-gray")}>{c.janelaAberta ? "Aberta" : "Fechada"}</span>}</td>
                  <td>{convCount[c.id] || 0}</td>
                  <td style={{ fontSize: 13, color: "var(--text-dim)" }}>{quando(c.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtrados.length > 500 && (
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>Mostrando 500 de {filtrados.length}. Use os filtros pra refinar.</div>
        )}
      </div>
    </>
  );
}
