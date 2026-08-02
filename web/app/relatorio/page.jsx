"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

export default function Relatorio() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [html, setHtml] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: d }) => {
      if (!d.session) { router.replace("/login"); return; }
      setPronto(true);
    });
  }, [router]);

  // O relatório agora exige auth (bridge fechou o endpoint público). Um <iframe src="...">
  // não manda Authorization -- por isso o fetch aqui, com o token da sessão já aberta, via
  // /api/relatorio (proxy same-origin em web/app/api/relatorio/route.js).
  useEffect(() => {
    if (!pronto) return;
    let cancelado = false;
    setHtml(null);
    setErro(null);
    supabase.auth.getSession().then(async ({ data: d }) => {
      const token = d.session?.access_token;
      if (!token) { router.replace("/login"); return; }
      try {
        const res = await fetch(`/api/relatorio?data=${data}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const texto = await res.text();
        if (cancelado) return;
        if (!res.ok) { setErro(texto || `erro ${res.status}`); return; }
        setHtml(texto);
      } catch (e) {
        if (!cancelado) setErro(String(e));
      }
    });
    return () => { cancelado = true; };
  }, [pronto, data, router]);

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando...</div>;

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
            {/* Aponta pra esta mesma página (não pro bridge direto) -- a nova aba reautentica
                pela sessão do browser em vez de precisar de um token na URL. */}
            <a href={`/relatorio?data=${data}`} target="_blank" rel="noopener" className="btn-ghost"
              style={{ fontSize: 13 }}>Abrir em nova aba</a>
          </div>
        </div>

        {erro && <p style={{ color: "#e74c3c" }}>Falha ao carregar relatório: {erro}</p>}

        <iframe srcDoc={html ?? ""} style={{
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
