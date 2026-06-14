"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";

function qualidade(q) {
  if (q === "GREEN") return ["badge-green", "Excelente"];
  if (q === "YELLOW") return ["badge-amber", "Atenção"];
  if (q === "RED") return ["badge-red", "Risco"];
  return ["badge-gray", "—"];
}

const REGRAS = [
  { t: "Janela de 24h", d: "Cliente te fala → 24h pra mandar qualquer coisa (texto/mídia livre). Fora das 24h: SÓ template aprovado. Disparo p/ cliente antigo = template." },
  { t: "Limites (tiers)", d: "250 → 1.000 → 10.000 → 100.000 → ilimitado, contando clientes ÚNICOS/24h. Sobe entregando 1.000 únicos em 30 dias com qualidade alta. Não dispare o teto no dia 1." },
  { t: "Quality rating", d: "Verde / Amarelo (Flagged) / Vermelho. Bloqueio e denúncia derrubam. Flagged por 7 dias → cai 1 nível. Baixo sustentado → número limitado/banido." },
  { t: "Templates", d: "Marketing / Utility / Authentication — precisam aprovação. Mídia vai no header (handle reusado, upload 1x)." },
  { t: "Limite por usuário", d: "Meta limita quantos templates de MARKETING um usuário recebe de QUALQUER empresa (frequency cap). Mudança de limites em 07/10/2025." },
  { t: "Pricing", d: "Agora é POR MENSAGEM (não mais por conversa). Recalcular custo do disparo por msg enviada." },
  { t: "Opt-in", d: "Template de marketing exige consentimento do cliente. Sem opt-in → denúncia → ban." },
];
const CHANGELOG_URL = "https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog";

function RegrasMeta() {
  const [checado, setChecado] = useState(null);
  useEffect(() => { try { setChecado(localStorage.getItem("meta_regras_checado")); } catch (_) {} }, []);
  function verificar() {
    const ts = new Date().toISOString();
    try { localStorage.setItem("meta_regras_checado", ts); } catch (_) {}
    setChecado(ts);
    window.open(CHANGELOG_URL, "_blank", "noopener");
  }
  return (
    <>
      <div className="section-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Regras da Meta (anti-ban)</span>
        <button className="btn-ghost" style={{ padding: "5px 11px", fontSize: 12, textTransform: "none", letterSpacing: 0 }} onClick={verificar}>
          Verificar atualizações ↗
        </button>
      </div>
      <div className="stat-grid">
        {REGRAS.map((r) => (
          <div key={r.t} className="card">
            <div style={{ fontWeight: 600, marginBottom: 5 }}>{r.t}</div>
            <div style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>{r.d}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>
        Última verificação: {checado ? new Date(checado).toLocaleString("pt-BR") : "nunca"}. Regras mudam — confira o changelog ~mensalmente.
      </div>
    </>
  );
}

// Catálogo de tecnologias do sistema. status derivado dos canais quando aplicável.
function integracoes(canais) {
  const tem = (t, st) => canais.some((c) => c.type === t && (!st || c.status === st));
  return [
    { sigla: "WA", cor: "#1fbf75", nome: "WhatsApp — API Oficial (Meta Cloud)", desc: "Mensagens oficiais. Sem proxy, número registrado na Meta.", ativo: tem("whatsapp", "active") || tem("whatsapp") },
    { sigla: "MS", cor: "#3b82f6", nome: "Facebook Messenger (Meta)", desc: "Mensagens da página do Facebook.", ativo: tem("facebook") },
    { sigla: "IG", cor: "#d4537e", nome: "Instagram Direct (Meta)", desc: "Mensagens diretas do Instagram.", ativo: tem("instagram") },
    { sigla: "EH", cor: "#00e2a0", nome: "EVO Hub — Gateway Meta", desc: "Proxy oficial para a Graph API (canais, tokens).", ativo: true },
    { sigla: "CW", cor: "#7c5cff", nome: "Chatwoot — Atendimento", desc: "Caixa de entrada do agente.", ativo: true },
    { sigla: "SB", cor: "#e6a019", nome: "Supabase — Banco & Login", desc: "System of record + autenticação do painel.", ativo: true },
  ];
}

export default function Tecnologias() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [saude, setSaude] = useState([]);
  const [canais, setCanais] = useState([]);
  const [carregandoSaude, setCarregandoSaude] = useState(true);

  const carregar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const ch = await supabase.from("channels").select("id,type,status");
    setCanais(ch.data || []);
    try {
      const res = await fetch(`${BRIDGE_URL}/channel-health`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await res.json();
      setSaude(j.channels || []);
    } catch (_) { setSaude([]); }
    setCarregandoSaude(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true);
      carregar();
    });
  }, [router, carregar]);

  if (!pronto) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando…</div>;

  const wa = saude.filter((c) => c.type === "whatsapp");
  const integs = integracoes(canais);

  return (
    <>
      <Nav />
      <div className="shell">
        <div style={{ marginBottom: 20 }}>
          <div className="display" style={{ fontSize: 26, fontWeight: 700 }}>Tecnologias</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 3 }}>
            Saúde dos números, integrações ativas e segurança
          </div>
        </div>

        <div className="callout" style={{ marginBottom: 22 }}>
          <div className="callout-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2l8 3v6c0 5-3.5 8.5-8 11-4.5-2.5-8-6-8-11V5l8-3z" stroke="#00e2a0" strokeWidth="2" strokeLinejoin="round"/><path d="M9 12l2 2 4-4" stroke="#00e2a0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 3 }}>Segurança — API Oficial, sem proxy</div>
            <div style={{ fontSize: 13.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
              Seus números usam a <b>API Oficial do WhatsApp (Meta Cloud)</b>. Não há proxy e o número
              <b> não cai por proxy</b> (isso é problema de WhatsApp não-oficial). A segurança real é o
              <b> quality rating</b> da Meta abaixo — mantenha-o <b>verde</b> evitando spam e respondendo rápido.
            </div>
          </div>
        </div>

        <div className="section-title">Saúde dos números (WhatsApp)</div>
        {carregandoSaude ? (
          <div className="card" style={{ color: "var(--text-dim)" }}>Verificando na Meta…</div>
        ) : wa.length === 0 ? (
          <div className="card" style={{ color: "var(--text-dim)" }}>Nenhum número WhatsApp ativo.</div>
        ) : (
          <div className="stat-grid">
            {wa.map((c) => {
              const [cls, txt] = qualidade(c.quality_rating);
              return (
                <div key={c.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 600 }}>{c.display_name || c.name}</span>
                    <span className={"badge " + cls}>{txt}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-dim)" }}>{c.phone_number || "—"}</div>
                  <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 8 }}>
                    Número: {c.number_status || "—"} · Qualidade Meta: {c.quality_rating || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="section-title">Integrações ativas</div>
        <div className="table-wrap">
          {integs.map((i) => (
            <div key={i.sigla} className="integ">
              <div className="integ-dot" style={{ background: i.cor }}>{i.sigla}</div>
              <div className="integ-body">
                <div className="integ-name">{i.nome}</div>
                <div className="integ-desc">{i.desc}</div>
              </div>
              <span className={"badge " + (i.ativo ? "badge-green" : "badge-gray")}>{i.ativo ? "Ativo" : "Inativo"}</span>
            </div>
          ))}
        </div>

        <RegrasMeta />

        <div className="section-title">Conectar novo sistema</div>
        <div className="card" style={{ color: "var(--text-dim)", fontSize: 14 }}>
          Em breve: conectar outros sistemas via API (CRM, ERP, e-commerce) pra puxar/empurrar dados pelo
          mesmo painel. Me diga quais sistemas você usa que eu preparo a integração.
        </div>
      </div>
    </>
  );
}
