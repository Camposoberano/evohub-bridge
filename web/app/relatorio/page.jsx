"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

export default function Relatorio() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => {
      if (!d.session) { router.replace("/login"); return; }
      setPronto(true);
    });
  }, [router]);

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando...</div>;

  const src = `${BRIDGE_URL}/relatorio?data=${data}`;

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>Relatório diário</div>
            <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
              Resumo das conversas e desempenho do bot
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border)" }} />
            <a href={src} target="_blank" rel="noopener" className="btn-ghost"
              style={{ fontSize: 13 }}>Abrir em nova aba</a>
          </div>
        </div>

        <iframe src={src} style={{
          width: "100%",
          height: "calc(100vh - 160px)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          background: "white",
        }} />
      </div>
    </>
  );
}
