"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

const PLAT = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram" };

function quando(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Contatos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [contatos, setContatos] = useState([]);
  const [convCount, setConvCount] = useState({});
  const [busca, setBusca] = useState("");

  const carregar = useCallback(async () => {
    const [ct, cv] = await Promise.all([
      supabase.from("contacts").select("*, channels(name,type)").order("last_seen_at", { ascending: false }).limit(500),
      supabase.from("conversations").select("contact_id"),
    ]);
    setContatos(ct.data || []);
    const m = {};
    for (const r of cv.data || []) m[r.contact_id] = (m[r.contact_id] || 0) + 1;
    setConvCount(m);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  const filtrados = contatos.filter((c) => {
    const s = busca.toLowerCase();
    return (c.name || "").toLowerCase().includes(s) || (c.phone || "").includes(s) || (c.external_contact_id || "").includes(s);
  });

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Contatos</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>Pessoas que entraram em contato</div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18 }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, telefone..." style={{ flex: 1 }} />
          <span className="badge badge-gray">{filtrados.length}</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Nome</th><th>Canal</th><th>Telefone</th><th>Conversas</th><th>Último contato</th></tr>
            </thead>
            <tbody>
              {filtrados.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-dim)", padding: 30 }}>Nenhum contato</td></tr>
              ) : filtrados.map((c) => (
                <tr key={c.id}>
                  <td>{c.name || <span style={{ color: "var(--text-faint)" }}>{c.external_contact_id}</span>}</td>
                  <td>{PLAT[c.channels?.type] || c.channels?.type || "—"}<div style={{ fontSize: 12, color: "var(--text-faint)" }}>{c.channels?.name}</div></td>
                  <td style={{ fontSize: 13 }}>{c.phone || "—"}</td>
                  <td>{convCount[c.id] || 0}</td>
                  <td style={{ fontSize: 13, color: "var(--text-dim)" }}>{quando(c.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
