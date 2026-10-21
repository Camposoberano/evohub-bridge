"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Nav from "@/components/Nav";

// Monitor da campanha de reativação (5 disparadores). Lê campaign_queue + campaign_flow_state
// + events direto pelo supabase client (mesma via da página de acompanhamento), sem endpoint
// no bridge. Auto-refresh a cada 30s.
const CAMPANHAS = [
  { id: "reativacao-5895-of", nome: "5895 oficial", tipo: "oficial" },
  { id: "reativacao-6836-of", nome: "6836 oficial", tipo: "oficial" },
  { id: "reativacao-5895-uz", nome: "5895 uazapi", tipo: "uazapi" },
  { id: "reativacao-6836-uz", nome: "6836 uazapi", tipo: "uazapi" },
  { id: "reativacao-0595-uz", nome: "0595 uazapi", tipo: "uazapi" },
];
const IDS = CAMPANHAS.map((c) => c.id);
const DIA_MS = 86400000;

function inicioDiaBrt() {
  const brt = new Date(Date.now() - 3 * 3600e3);
  brt.setUTCHours(0, 0, 0, 0);
  return new Date(brt.getTime() + 3 * 3600e3).toISOString();
}

function Kpi({ titulo, valor, cor }) {
  return (
    <div className="card" style={{ padding: 14, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em" }}>{titulo}</div>
      <div className="display" style={{ fontSize: 26, color: cor || "var(--text)", marginTop: 6, lineHeight: 1.1 }}>{valor}</div>
    </div>
  );
}

export default function Reativacao() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [fila, setFila] = useState([]);
  const [estados, setEstados] = useState([]);
  const [eventos, setEventos] = useState([]);
  const [atualizado, setAtualizado] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setPronto(true);
    });
  }, [router]);

  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - DIA_MS).toISOString();
    const [q, f, e] = await Promise.all([
      supabase.schema("public").from("campaign_queue").select("campaign_id,status,sent_at").in("campaign_id", IDS).limit(20000),
      supabase.schema("public").from("campaign_flow_state").select("campaign_id,step_id,status").in("campaign_id", IDS).limit(20000),
      supabase.schema("public").from("events").select("event_type,occurred_at").gte("occurred_at", desde)
        .in("event_type", ["pediu_humano", "envio_bloqueado_etiqueta", "message_failed", "message_held_window"]).limit(5000),
    ]);
    setFila(q.data ?? []);
    setEstados(f.data ?? []);
    setEventos(e.data ?? []);
    setAtualizado(new Date());
  }, []);

  useEffect(() => {
    if (!pronto) return;
    carregar();
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [pronto, carregar]);

  if (!pronto) return null;

  const dia = inicioDiaBrt();
  const porCamp = {};
  for (const c of CAMPANHAS) porCamp[c.id] = { total: 0, sent: 0, hoje: 0, pending: 0, failed: 0, skipped: 0, paused: 0, recebeu: 0, semClique: 0, clicou: 0, area: 0, fechou: 0 };
  for (const r of fila) {
    const c = porCamp[r.campaign_id]; if (!c) continue;
    c.total++; c[r.status] = (c[r.status] || 0) + 1;
    if (r.status === "sent" && r.sent_at && r.sent_at >= dia) c.hoje++;
  }
  for (const r of estados) {
    const c = porCamp[r.campaign_id]; if (!c) continue;
    c.recebeu++;
    if (r.step_id === "abertura") c.semClique++;
    else { c.clicou++; if (r.step_id === "area") c.area++; if (!r.step_id || r.status === "done") c.fechou++; }
  }
  const tot = (k) => CAMPANHAS.reduce((a, c) => a + porCamp[c.id][k], 0);
  const evCount = {};
  for (const e of eventos) evCount[e.event_type] = (evCount[e.event_type] || 0) + 1;

  const janela = (() => { const h = new Date(Date.now() - 3 * 3600e3).getUTCHours(); return h >= 8 && h < 18; })();

  return (
    <>
      <Nav />
      <main className="container" style={{ paddingBottom: 60 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, margin: "18px 0 14px" }}>
          <h1 className="display" style={{ fontSize: 24, margin: 0 }}>Reativação — monitor</h1>
          <div style={{ fontSize: 12, color: "var(--text-dim)" }}>
            janela 8–18h: <b style={{ color: janela ? "var(--green)" : "var(--amber)" }}>{janela ? "aberta" : "fechada"}</b>
            {atualizado && <> · atualizado {atualizado.toLocaleTimeString("pt-BR")}</>} · auto 30s
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10, marginBottom: 18 }}>
          <Kpi titulo="Enfileirado" valor={tot("total").toLocaleString("pt-BR")} />
          <Kpi titulo="Enviado hoje" valor={tot("hoje").toLocaleString("pt-BR")} cor="var(--green)" />
          <Kpi titulo="Enviado total" valor={tot("sent").toLocaleString("pt-BR")} />
          <Kpi titulo="Clicaram" valor={tot("clicou").toLocaleString("pt-BR")} cor="var(--green)" />
          <Kpi titulo="Handoffs (cotação)" valor={(evCount.pediu_humano || 0).toLocaleString("pt-BR")} cor="var(--amber)" />
          <Kpi titulo="Falhas 24h" valor={(evCount.message_failed || 0).toLocaleString("pt-BR")} cor={evCount.message_failed ? "var(--red)" : "var(--text)"} />
        </div>

        <div className="card" style={{ padding: 0, overflowX: "auto", marginBottom: 18 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 720 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--text-faint)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Disparador</th>
                <th style={{ padding: "10px 12px" }}>Fila</th>
                <th style={{ padding: "10px 12px" }}>Env. hoje</th>
                <th style={{ padding: "10px 12px" }}>Enviado</th>
                <th style={{ padding: "10px 12px" }}>Pend.</th>
                <th style={{ padding: "10px 12px" }}>Clicou</th>
                <th style={{ padding: "10px 12px" }}>Na área</th>
                <th style={{ padding: "10px 12px" }}>Fechou</th>
                <th style={{ padding: "10px 12px" }}>Falha/Pulado</th>
              </tr>
            </thead>
            <tbody>
              {CAMPANHAS.map((c) => {
                const d = porCamp[c.id];
                const clk = d.sent ? Math.round((d.clicou / d.sent) * 100) : 0;
                return (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--border)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <td style={{ textAlign: "left", padding: "10px 12px" }}>
                      <b>{c.nome}</b>
                      <span style={{ fontSize: 11, color: "var(--text-faint)", marginLeft: 6, padding: "1px 7px", borderRadius: 999, background: "var(--bg-deep)" }}>{c.tipo}</span>
                    </td>
                    <td style={{ padding: "10px 12px" }}>{d.total.toLocaleString("pt-BR")}</td>
                    <td style={{ padding: "10px 12px", color: "var(--green)" }}>{d.hoje}</td>
                    <td style={{ padding: "10px 12px" }}>{d.sent}</td>
                    <td style={{ padding: "10px 12px", color: "var(--text-dim)" }}>{d.pending}</td>
                    <td style={{ padding: "10px 12px" }}>{d.clicou} <span style={{ color: "var(--text-faint)", fontSize: 11 }}>({clk}%)</span></td>
                    <td style={{ padding: "10px 12px" }}>{d.area}</td>
                    <td style={{ padding: "10px 12px", color: "var(--green)" }}>{d.fechou}</td>
                    <td style={{ padding: "10px 12px", color: d.failed ? "var(--red)" : "var(--text-faint)" }}>{d.failed}/{d.skipped}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 10 }}>Eventos (24h)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
            {[["pediu_humano", "Pediu cotação (Cícero)", "var(--amber)"], ["envio_bloqueado_etiqueta", "Bloqueado por etiqueta", "var(--text)"], ["message_failed", "Falhas de envio", "var(--red)"], ["message_held_window", "Segurado pela janela", "var(--text-dim)"]].map(([k, lab, cor]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{lab}</span>
                <b style={{ color: cor, fontVariantNumeric: "tabular-nums" }}>{evCount[k] || 0}</b>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 12 }}>
            Funil: "clicou" = abriu o vídeo (saiu do abridor); "na área" = respondeu a pergunta de área; "fechou" = escolheu pacote → handoff pro Cícero.
          </div>
        </div>
      </main>
    </>
  );
}
