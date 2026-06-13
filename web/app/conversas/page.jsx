"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL, chatwootConversationUrl } from "@/lib/supabase";
import Nav from "@/components/Nav";

const PLAT = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram" };

function statusBadge(s) {
  if (s === "open") return ["badge-green", "Aberta"];
  if (s === "resolved") return ["badge-gray", "Resolvida"];
  if (s === "pending") return ["badge-amber", "Pendente"];
  return ["badge-gray", s || "—"];
}
function outcomeBadge(o) {
  if (o === "won") return ["badge-green", "Ganho"];
  if (o === "lost") return ["badge-red", "Perdido"];
  return ["badge-gray", "Aberto"];
}
function quando(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Conversas() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [convs, setConvs] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState("todas");
  const [busca, setBusca] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("conversations")
      .select("*, contacts(name,phone,external_contact_id), channels(name,type)")
      .order("opened_at", { ascending: false })
      .limit(300);
    setConvs(data || []);
  }, []);

  useEffect(() => {
    let timer;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
      timer = setInterval(carregar, 8000);
    });
    return () => clearInterval(timer);
  }, [router, carregar]);

  async function marcar(conv, outcome) {
    let valueCents = null;
    if (outcome === "won") {
      const v = prompt("Valor do ganho (R$) — opcional, deixe vazio se não souber:", "");
      if (v === null) return; // cancelou
      const n = parseFloat((v || "").replace(",", "."));
      if (!isNaN(n) && n > 0) valueCents = Math.round(n * 100);
    }
    setSalvandoId(conv.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BRIDGE_URL}/conversation-outcome`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conv.id, outcome, value_cents: valueCents }),
      });
      const j = await res.json();
      if (!res.ok) { alert(j.error || "Erro ao salvar"); return; }
      carregar();
    } catch (e) {
      alert("Falha: " + e.message);
    } finally {
      setSalvandoId(null);
    }
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  const filtradas = convs.filter((c) => {
    if (filtroStatus !== "todas" && c.status !== filtroStatus) return false;
    const nome = (c.contacts?.name || c.contacts?.external_contact_id || "").toLowerCase();
    return nome.includes(busca.toLowerCase());
  });

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Conversas</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Acompanhe e marque o resultado comercial (ganho/perdido)
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por contato..." style={{ flex: 1, minWidth: 200 }} />
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="open">Abertas</option>
            <option value="resolved">Resolvidas</option>
          </select>
          <span className="badge badge-gray">{filtradas.length}</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Contato</th><th>Canal</th><th>Status</th><th>Resultado</th><th>Aberta</th><th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-dim)", padding: 30 }}>Nenhuma conversa</td></tr>
              ) : filtradas.map((c) => {
                const [scls, stxt] = statusBadge(c.status);
                const [ocls, otxt] = outcomeBadge(c.outcome);
                const cwUrl = chatwootConversationUrl(c.chatwoot_conversation_id);
                const nome = c.contacts?.name || c.contacts?.external_contact_id || "—";
                const valor = c.outcome === "won" && c.outcome_value_cents
                  ? " · " + (c.outcome_value_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                  : "";
                return (
                  <tr key={c.id}>
                    <td>
                      {cwUrl ? <a href={cwUrl} target="_blank" rel="noopener" style={{ color: "var(--mint)" }}>{nome}</a> : nome}
                      {c.contacts?.phone && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{c.contacts.phone}</div>}
                    </td>
                    <td>{PLAT[c.channels?.type] || c.channels?.type || "—"}<div style={{ fontSize: 12, color: "var(--text-faint)" }}>{c.channels?.name}</div></td>
                    <td><span className={"badge " + scls}>{stxt}</span></td>
                    <td><span className={"badge " + ocls}>{otxt}</span>{valor && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{valor}</span>}</td>
                    <td style={{ fontSize: 13, color: "var(--text-dim)" }}>{quando(c.opened_at)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button className="btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                          disabled={salvandoId === c.id} onClick={() => marcar(c, "won")}>Ganho</button>
                        <button className="btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                          disabled={salvandoId === c.id} onClick={() => marcar(c, "lost")}>Perdido</button>
                        {c.outcome !== "open" && (
                          <button className="btn-ghost" style={{ padding: "5px 10px", fontSize: 12 }}
                            disabled={salvandoId === c.id} onClick={() => marcar(c, "open")}>↺</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
