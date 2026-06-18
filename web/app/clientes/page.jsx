"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
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
  const limit = 50;

  async function get(path) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (busca) params.set("q", busca);
    if (wa) params.set("wa", "1");
    const r = await get(`/clientes?${params}`);
    if (r.ok) { setRows(r.data.clientes || []); setTotal(r.data.total || 0); }
    const s = await get("/clientes?stats=1");
    if (s.ok) setStats(s.data);
  }, [page, busca, wa]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
    });
  }, [router]);
  useEffect(() => { if (pronto) carregar(); }, [pronto, carregar]);

  const pages = Math.ceil(total / limit) || 1;
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

        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setBusca(q); } }}
            placeholder="Buscar nome ou número… (Enter)" style={{ flex: 1, minWidth: 220 }} />
          <label style={{ fontSize: 13, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={wa} onChange={(e) => { setWa(e.target.checked); setPage(1); }} style={{ width: "auto" }} /> Só com WhatsApp
          </label>
          <button className="btn-ghost mini" onClick={() => { setPage(1); setBusca(q); }}>Buscar</button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead><tr><th></th><th>Nome</th><th>Número</th><th>WhatsApp</th><th>Origem</th><th>Grupos</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--text-dim)", padding: 24 }}>Nenhum cliente</td></tr> :
                rows.map((c) => (
                  <tr key={c.phone}>
                    <td style={{ width: 40 }}>{c.image_preview ? <img src={c.image_preview} alt="" style={{ width: 30, height: 30, borderRadius: 999, objectFit: "cover" }} /> : <span style={{ width: 30, height: 30, borderRadius: 999, background: "var(--surface-2)", display: "inline-block" }} />}</td>
                    <td>{c.wa_name || c.wa_contact_name || c.verified_name || <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{c.phone}</td>
                    <td>{c.on_whatsapp === true ? <span className="badge badge-green">sim</span> : c.on_whatsapp === false ? <span className="badge badge-red">não</span> : <span className="badge badge-gray">?</span>}</td>
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
    </>
  );
}
