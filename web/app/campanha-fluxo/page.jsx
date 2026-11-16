"use client";
// Campanha de Fluxo — manda um FLUXO PUBLICADO para um Público (ou números colados), pela fila
// do bridge (ação /campaign agendar-fluxo). Versão enxuta do port CECAPE: escolhe fluxo + canal +
// público, enfileira e acompanha. Ritmo/gatilho/template são enhancements (ver SECAP completo).
import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";
import SeletorPublico from "@/components/SeletorPublico";
import { parsePastedPhones } from "@/lib/phone-paste.mjs";

export default function CampanhaFluxo() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [fluxos, setFluxos] = useState([]);
  const [fluxoId, setFluxoId] = useState("");
  const [canais, setCanais] = useState([]);
  const [canalId, setCanalId] = useState("");
  const [nome, setNome] = useState("");
  const [publicoNums, setPublicoNums] = useState([]);
  const [manual, setManual] = useState("");
  const [lancando, setLancando] = useState(false);
  const [campanha, setCampanha] = useState(null);
  const [fila, setFila] = useState(null);
  const [msg, setMsg] = useState("");

  async function post(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${BRIDGE_URL}/campaign`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.json().catch(() => ({}));
  }

  const carregar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const authH = { Authorization: `Bearer ${session?.access_token ?? ""}` };
    const fx = await fetch(`${BRIDGE_URL}/flows`, { headers: authH }).then((r) => r.json()).catch(() => ({}));
    setFluxos((fx.flows ?? []).filter((f) => f.status === "published"));
    const { data: chs } = await supabase.from("channels")
      .select("id,name,phone_number,external_id").eq("type", "whatsapp").eq("status", "active").order("name");
    setCanais(chs ?? []);
    if (chs?.length && !canalId) setCanalId(chs[0].id);
  }, [canalId]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  const numerosManuais = useMemo(
    () => parsePastedPhones(manual).filter((d) => d.length >= 12), [manual]);
  const numeros = useMemo(
    () => [...new Set([...publicoNums, ...numerosManuais])].filter((n) => n.length >= 12),
    [publicoNums, numerosManuais]);

  async function carregarGrafoPublicado(id) {
    const { data: { session } } = await supabase.auth.getSession();
    const body = await fetch(`${BRIDGE_URL}/flows?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
    }).then((r) => r.json()).catch(() => ({}));
    return body.published_graph ?? body.definition?.graph_json ?? null;
  }

  async function lancar() {
    setMsg("");
    if (!fluxoId) { setMsg("escolha um fluxo publicado"); return; }
    if (!canalId) { setMsg("escolha o canal"); return; }
    if (!numeros.length) { setMsg("escolha um público ou cole números"); return; }
    setLancando(true);
    const grafo = await carregarGrafoPublicado(fluxoId);
    if (!grafo?.steps?.length) { setLancando(false); setMsg("fluxo publicado sem passos"); return; }
    const flowName = fluxos.find((f) => f.id === fluxoId)?.name ?? "Fluxo";
    const r = await post({
      action: "agendar-fluxo",
      name: nome.trim() || `${flowName} — ${new Date().toLocaleDateString("pt-BR")}`,
      channel_id: canalId, numbers: numeros, flow: grafo,
    });
    setLancando(false);
    if (r.error) { setMsg(`erro: ${r.error}${r.problemas ? " — " + r.problemas.map((p) => p.problema).join("; ") : ""}`); return; }
    setCampanha({ id: r.campaign });
    setMsg(`campanha lançada: ${r.enfileirados} na fila. ${r.aviso ?? ""}`);
    atualizarFila(r.campaign);
  }

  async function atualizarFila(id = campanha?.id) {
    if (!id) return;
    const r = await post({ action: "fila", campaign: id });
    if (!r.error) setFila(r);
  }
  async function controlar(action) {
    if (!campanha?.id) return;
    await post({ action, campaign: campanha.id });
    atualizarFila();
  }

  useEffect(() => {
    if (!pronto || !campanha?.id) return;
    const t = setInterval(() => atualizarFila(), 8000);
    return () => clearInterval(t);
  }, [pronto, campanha?.id]); // eslint-disable-line

  if (!pronto) return null;
  const card = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 14, padding: 18 };
  const labelUp = { fontSize: 12, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: ".08em" };
  const sel = { width: "100%", marginTop: 8, padding: "9px 11px", borderRadius: 10, fontSize: 14 };

  return (
    <>
      <Nav />
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "20px 16px 60px" }}>
        <h1 className="page-title">Campanha de fluxo</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 20 }}>
          Manda um fluxo publicado para um Público (ou números colados), pela fila do bridge.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={card}>
            <label style={labelUp}>1. Fluxo publicado</label>
            <select value={fluxoId} onChange={(e) => setFluxoId(e.target.value)} style={sel}>
              <option value="">— escolher —</option>
              {fluxos.map((f) => <option key={f.id} value={f.id}>{f.name} (v{f.current_version})</option>)}
            </select>
            {!fluxos.length && <div style={{ fontSize: 12, color: "var(--amber)", marginTop: 8 }}>Nenhum fluxo publicado. Publique um em <Link href="/fluxos">Fluxos</Link>.</div>}
            <label style={{ ...labelUp, display: "block", marginTop: 16 }}>Canal</label>
            <select value={canalId} onChange={(e) => setCanalId(e.target.value)} style={sel}>
              <option value="">— escolher canal —</option>
              {canais.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone_number ? ` — ${c.phone_number}` : ""}</option>)}
            </select>
            <label style={{ ...labelUp, display: "block", marginTop: 16 }}>Nome da campanha (opcional)</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} style={sel} placeholder="deixe vazio para gerar automático" />
          </div>

          <div style={card}>
            <label style={labelUp}>2. Audiência <span style={{ color: "var(--mint)" }}>({numeros.length})</span></label>
            <SeletorPublico onNums={setPublicoNums} />
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--text-faint)" }}>Ou colar números manualmente</summary>
              <textarea value={manual} onChange={(e) => setManual(e.target.value)} placeholder={"5519999999999\n5511888888888"} style={{ width: "100%", marginTop: 8, minHeight: 60, fontSize: 13, padding: 10, borderRadius: 10, resize: "vertical" }} />
              {numerosManuais.length > 0 && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{numerosManuais.length} número(s) colado(s)</div>}
            </details>
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-dim)" }}>
              Vai enviar para <b style={{ color: "var(--text)" }}>{numeros.length}</b> contato(s) pela fila (ritmo padrão do bridge).
            </div>
          </div>

          <div style={card}>
            <button className="btn-mint" onClick={lancar} disabled={lancando || !fluxoId || !numeros.length}
              style={{ width: "100%", padding: "12px", borderRadius: 10, justifyContent: "center" }}>
              {lancando ? "Lançando…" : "Lançar campanha"}
            </button>
            {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith("erro") ? "var(--red)" : msg.includes("lançada") ? "var(--green)" : "var(--amber)" }}>{msg}</div>}

            {campanha && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label style={labelUp}>Acompanhamento</label>
                  <button className="btn-ghost mini" onClick={() => atualizarFila()}>Atualizar</button>
                </div>
                <code style={{ fontSize: 11, color: "var(--text-faint)" }}>{campanha.id}</code>
                {fila && (
                  <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                    {[["pendentes", fila.pendentes, "var(--amber)"], ["enviados", fila.enviados, "var(--green)"], ["falhas", fila.falhas, "var(--red)"], ["pausados", fila.pausados, "var(--text-dim)"], ["pulados", fila.pulados, "var(--text-faint)"]].map(([k, v, cor]) => (
                      <div key={k} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "8px 10px" }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: cor }}>{v ?? 0}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{k}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button className="btn-ghost mini" onClick={() => controlar("pausar-campanha")}>Pausar</button>
                  <button className="btn-ghost mini" onClick={() => controlar("retomar-campanha")}>Retomar</button>
                  <button className="btn-ghost mini" style={{ color: "var(--red)" }} onClick={() => controlar("cancelar-campanha")}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
