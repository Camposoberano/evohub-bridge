"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL, chatwootConversationUrl } from "@/lib/supabase";
import Nav from "@/components/Nav";

const PLAT = { whatsapp: "WhatsApp", facebook: "Facebook", instagram: "Instagram" };
const UFS = [
  ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"], ["BA", "Bahia"],
  ["CE", "Ceará"], ["DF", "Distrito Federal"], ["ES", "Espírito Santo"], ["GO", "Goiás"],
  ["MA", "Maranhão"], ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"], ["MG", "Minas Gerais"],
  ["PA", "Pará"], ["PB", "Paraíba"], ["PR", "Paraná"], ["PE", "Pernambuco"], ["PI", "Piauí"],
  ["RJ", "Rio de Janeiro"], ["RN", "Rio Grande do Norte"], ["RS", "Rio Grande do Sul"],
  ["RO", "Rondônia"], ["RR", "Roraima"], ["SC", "Santa Catarina"], ["SP", "São Paulo"],
  ["SE", "Sergipe"], ["TO", "Tocantins"],
];

function classificacao(conv) {
  return Array.isArray(conv.leads_qualification)
    ? conv.leads_qualification[0] || null
    : conv.leads_qualification || null;
}

function statusBadge(s) {
  if (s === "open") return ["badge-green", "Aberta"];
  if (s === "resolved") return ["badge-gray", "Resolvida"];
  if (s === "pending") return ["badge-amber", "Pendente"];
  return ["badge-gray", s || "—"];
}
function outcomeBadge(o) {
  if (o === "won") return ["badge-green", "Ganho"];
  if (o === "lost") return ["badge-red", "Perdido"];
  if (o === "open") return ["badge-gray", "Em andamento"];
  return ["badge-gray", "Não classificado"];
}
function etapaQualificacao(stage) {
  const labels = {
    started: "iniciada",
    objective: "objetivo informado",
    region: "estado informado",
    hectares: "área informada",
    date: "plantio informado",
    complete: "completa",
    awaiting_objective: "aguardando objetivo",
    awaiting_region: "aguardando estado",
    awaiting_hectares: "aguardando área",
    awaiting_date: "aguardando plantio",
  };
  return labels[stage] || String(stage || "não iniciada").replaceAll("_", " ");
}
function quando(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function valorEmCentavos(texto) {
  const limpo = String(texto || "").trim().replace(/[^\d,.-]/g, "");
  if (!limpo) return null;
  const virgula = limpo.lastIndexOf(",");
  const ponto = limpo.lastIndexOf(".");
  const normalizado = virgula >= 0 && ponto >= 0
    ? (virgula > ponto ? limpo.replace(/\./g, "").replace(",", ".") : limpo.replace(/,/g, ""))
    : virgula >= 0
      ? limpo.replace(",", ".")
      : /^-?\d{1,3}(?:\.\d{3})+$/.test(limpo)
        ? limpo.replace(/\./g, "")
        : limpo;
  const valor = Number(normalizado);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) : null;
}

export default function Conversas() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [convs, setConvs] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState("todas");
  const [filtroResultado, setFiltroResultado] = useState("todos");
  const [filtroPeriodo, setFiltroPeriodo] = useState("30");
  const [filtroCanal, setFiltroCanal] = useState("todos");
  const [filtroUf, setFiltroUf] = useState("todas");
  const [busca, setBusca] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);

  const carregar = useCallback(async (periodo) => {
    let q = supabase.from("conversations")
      .select("*, contacts(name,phone,external_contact_id), channels(id,name,type,phone_number), leads_qualification(region,objective,qualification_stage)")
      .order("opened_at", { ascending: false }).limit(500);
    if (periodo !== "todos") {
      q = q.gte("opened_at", new Date(Date.now() - Number(periodo) * 86_400_000).toISOString());
    }
    const { data } = await q;
    setConvs(data || []);
  }, []);

  useEffect(() => {
    let timer;
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar(filtroPeriodo);
      timer = setInterval(() => carregar(filtroPeriodo), 8000);
    });
    return () => clearInterval(timer);
  }, [router, carregar, filtroPeriodo]);

  async function marcar(conv, outcome) {
    let valueCents = null;
    if (outcome === "won") {
      const v = prompt("Valor do ganho (R$) — opcional, deixe vazio se não souber:", "");
      if (v === null) return; // cancelou
      valueCents = valorEmCentavos(v);
      if (v.trim() && valueCents === null) {
        alert("Valor inválido. Use, por exemplo, 1250,50 ou 1.250,50.");
        return;
      }
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
      carregar(filtroPeriodo);
    } catch (e) {
      alert("Falha: " + e.message);
    } finally {
      setSalvandoId(null);
    }
  }

  async function atualizarUf(conv, region) {
    setSalvandoId(conv.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${BRIDGE_URL}/conversation-classification`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conv.id, region: region || null }),
      });
      const result = await res.json();
      if (!res.ok) { alert(result.error || "Erro ao salvar a UF"); return; }
      await carregar(filtroPeriodo);
    } catch (e) {
      alert("Falha: " + e.message);
    } finally {
      setSalvandoId(null);
    }
  }

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  const filtradas = convs.filter((c) => {
    if (filtroStatus !== "todas" && c.status !== filtroStatus) return false;
    if (filtroResultado === "sem_resultado" && c.outcome) return false;
    if (!['todos', 'sem_resultado'].includes(filtroResultado) && c.outcome !== filtroResultado) return false;
    if (filtroCanal !== "todos" && c.channel_id !== filtroCanal) return false;
    const region = classificacao(c)?.region || "";
    if (filtroUf === "sem_uf" && region) return false;
    if (filtroUf !== "todas" && filtroUf !== "sem_uf" && region !== filtroUf) return false;
    const nome = (c.contacts?.name || c.contacts?.external_contact_id || "").toLowerCase();
    return nome.includes(busca.toLowerCase());
  });

  return (
    <>
      <Nav />
      <div className="shell">
        {(() => {
          const comUf = convs.filter((c) => classificacao(c)?.region).length;
          return (
            <div style={{ marginBottom: 16, padding: "12px 15px", border: "1px solid var(--border-soft)", borderRadius: 14, background: "var(--surface)" }}>
              <strong>Qualidade do registro</strong>
              <span style={{ marginLeft: 12, color: "var(--text-dim)", fontSize: 13 }}>UF declarada: {comUf}/{convs.length} conversas carregadas · {convs.length - comUf} sem UF</span>
              <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 5 }}>Registre a UF informada pelo cliente durante o atendimento. O sistema não deduz o estado pelo DDD.</div>
            </div>
          );
        })()}
        <div style={{ marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Conversas</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Classifique a UF informada pelo cliente e registre o resultado comercial.
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por contato..." style={{ flex: 1, minWidth: 200 }} />
          <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
            <option value="todas">Todas</option>
            <option value="open">Abertas</option>
            <option value="resolved">Resolvidas</option>
          </select>
          <select value={filtroResultado} onChange={(e) => setFiltroResultado(e.target.value)} aria-label="Filtrar pelo resultado comercial">
            <option value="todos">Todos os resultados</option>
            <option value="open">Em andamento</option>
            <option value="won">Ganho</option>
            <option value="lost">Perdido</option>
            <option value="sem_resultado">Não classificado</option>
          </select>
          <select value={filtroPeriodo} onChange={(e) => setFiltroPeriodo(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="todos">Todo o período</option>
          </select>
          <select value={filtroCanal} onChange={(e) => setFiltroCanal(e.target.value)}>
            <option value="todos">Todos os números/canais</option>
            {[...new Map(convs.map((c) => [c.channel_id, c.channels])).entries()].map(([id, ch]) => (
              <option key={id} value={id}>{ch?.name || ch?.phone_number || id}</option>
            ))}
          </select>
          <select value={filtroUf} onChange={(e) => setFiltroUf(e.target.value)} aria-label="Filtrar por UF declarada">
            <option value="todas">Todas as UFs</option>
            <option value="sem_uf">UF não informada</option>
            {UFS.map(([uf, nome]) => <option key={uf} value={uf}>{uf} — {nome}</option>)}
          </select>
          <span className="badge badge-gray">{filtradas.length}</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Contato</th><th>Canal</th><th>UF declarada</th><th>Qualificação</th><th>Status</th><th>Resultado</th><th>Aberta</th><th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--text-dim)", padding: 30 }}>Nenhuma conversa</td></tr>
              ) : filtradas.map((c) => {
                const [scls, stxt] = statusBadge(c.status);
                const [ocls, otxt] = outcomeBadge(c.outcome);
                const lead = classificacao(c);
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
                    <td>
                      <select value={lead?.region || ""} disabled={salvandoId === c.id} onChange={(e) => atualizarUf(c, e.target.value)} aria-label="UF declarada no atendimento" style={{ minWidth: 150, padding: "7px 9px", fontSize: 12 }}>
                        <option value="">Não informada</option>
                        {UFS.map(([uf, nome]) => <option key={uf} value={uf}>{uf} — {nome}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--text-dim)" }}>
                      {lead?.objective || "Objetivo pendente"}
                      <div style={{ color: "var(--text-faint)", marginTop: 3 }}>Etapa: {etapaQualificacao(lead?.qualification_stage)}</div>
                    </td>
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
