"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/conexoes");
    });
  }, [router]);

  async function entrar(e) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setCarregando(false);
    if (error) setErro("E-mail ou senha inválidos.");
    else router.replace("/conexoes");
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <form onSubmit={entrar} className="card" style={{ width: 360, maxWidth: "100%" }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 2 }}>Evo Hub</div>
        <div style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 22 }}>Entre no seu painel</div>

        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>E-mail</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com"
          style={{ width: "100%", margin: "6px 0 14px" }} required />

        <label style={{ fontSize: 13, color: "var(--text-dim)" }}>Senha</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
          style={{ width: "100%", margin: "6px 0 18px" }} required />

        {erro && <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 14 }}>{erro}</div>}

        <button type="submit" className="btn-mint" disabled={carregando} style={{ width: "100%", justifyContent: "center" }}>
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
