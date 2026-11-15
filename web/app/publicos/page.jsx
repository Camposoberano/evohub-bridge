"use client";
// Públicos — lista + criar. A edição (tabela tipo Excel: colunas, células, pessoas) fica em
// /publicos/[id]. Leitura/escrita via bridge (audiences tem RLS que bloqueia leitura direta).
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase, BRIDGE_URL } from "@/lib/supabase";
import Nav from "@/components/Nav";
import { decodeAudienceCsv, hasReplacementCharacter, parseAudienceCsv } from "@/lib/audience-csv.mjs";
import { parsePastedPhones } from "@/lib/phone-paste.mjs";

function normFone(raw) {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d;
  if (d.length < 12 || d.length > 13) return null;
  return d;
}

export default function Publicos() {
  const router = useRouter();
  const [pronto, setPronto] = useState(false);
  const [publicos, setPublicos] = useState([]);
  const [nome, setNome] = useState("");
  const [tag, setTag] = useState("");
  const [arquivo, setArquivo] = useState("");
  const [manual, setManual] = useState("");
  const [contatos, setContatos] = useState([]);
  const [colunas, setColunas] = useState([]);
  const [colunaNome, setColunaNome] = useState("");
  const [colunaTelefone, setColunaTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState("");

  async function authH() {
    const { data: { session } } = await supabase.auth.getSession();
    return { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" };
  }
  async function post(payload) {
    const h = await authH();
    return fetch(`${BRIDGE_URL}/audiences`, { method: "POST", headers: h, body: JSON.stringify(payload) }).then((r) => r.json()).catch(() => ({ error: "falha de rede" }));
  }

  const carregar = useCallback(async () => {
    const h = await authH();
    const b = await fetch(`${BRIDGE_URL}/audiences`, { headers: h }).then((r) => r.json()).catch(() => ({}));
    setPublicos(b.audiences ?? []);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.replace("/login"); return; }
      setPronto(true); carregar();
    });
  }, [router, carregar]);

  function aoEscolherArquivo(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArquivo(f.name); setMsg("");
    f.arrayBuffer().then((buffer) => {
      const parsed = parseAudienceCsv(decodeAudienceCsv(buffer));
      if (parsed.headers.some(hasReplacementCharacter) || parsed.rows.some((c) =>
        hasReplacementCharacter(c.name) || Object.values(c.attributes).some(hasReplacementCharacter))) {
        throw new Error("O arquivo contém �. Corrija a fonte original antes de importar.");
      }
      setColunas(parsed.headers);
      setColunaNome(parsed.nameColumn ?? "");
      setColunaTelefone(parsed.phoneColumn ?? "");
      setContatos(parsed.rows.map((c) => ({ ...c, fone: normFone(c.phone) })));
      if (!nome) setNome(f.name.replace(/\.csv$/i, ""));
    }).catch((error) => {
      setContatos([]); setColunas([]); setColunaNome(""); setColunaTelefone("");
      setMsg(error instanceof TypeError
        ? "Codificação inválida: use CSV UTF-8 ou Windows-1252."
        : error.message);
    });
  }

  function lerNumerosColados() {
    const phones = parsePastedPhones(manual);
    if (!phones.length) { setMsg("nenhum telefone legível no texto"); return; }
    setArquivo(""); setColunas([]); setColunaNome(""); setColunaTelefone("");
    setContatos(phones.map((phone) => ({ phone, fone: normFone(phone), name: "", attributes: {} })));
    setMsg(`${phones.length} número(s) lido(s), sem enviar mensagens.`);
  }

  const validos = contatos.filter((c) => c.fone);
  const unicos = new Set(validos.map((c) => c.fone)).size;
  const invalidos = contatos.length - validos.length;

  async function salvar() {
    if (!nome.trim()) { setMsg("dê um nome ao público"); return; }
    if (!validos.length) { setMsg("nenhum telefone válido no CSV"); return; }
    setSalvando(true); setMsg("");
    const r = await post({ action: "save", name: nome.trim(), tag: tag.trim() || undefined,
      columns: colunas, contacts: validos.map((c) => ({ phone: c.fone, name: c.name, attributes: c.attributes })) });
    setSalvando(false);
    if (r.error) { setMsg(`erro: ${r.error}`); return; }
    setNome(""); setTag(""); setArquivo(""); setManual(""); setContatos([]); setColunas([]);
    setColunaNome(""); setColunaTelefone("");
    carregar();
    if (r.id) router.push(`/publicos/${r.id}`); // abre a tabela do público recém-criado
  }

  async function excluir(id, nomeP) {
    if (!confirm(`Excluir o público "${nomeP}"? Os contatos salvos nele também somem.`)) return;
    const r = await post({ action: "delete", id });
    if (r.error) { setMsg(`erro ao excluir: ${r.error}`); return; }
    carregar();
  }

  if (!pronto) return null;
  const card = { background: "var(--surface)", border: "1px solid var(--border-soft)", borderRadius: 14, padding: 18 };
  const lbl = { fontSize: 12, fontWeight: 700, color: "var(--text-faint)", display: "block", marginBottom: 5, marginTop: 12 };
  const inp = { width: "100%", fontSize: 14, padding: "9px 11px", borderRadius: 10 };

  return (
    <>
      <Nav />
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "20px 16px 60px" }}>
        <h1 className="page-title">Públicos</h1>
        <p style={{ color: "var(--text-dim)", fontSize: 14, marginBottom: 20 }}>
          Dê nome à tabela e importe um CSV UTF-8 ou Windows-1252. Nome e telefone identificam os destinatários; as demais colunas são livres e preservadas.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 16, alignItems: "start" }}>
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>Novo público</div>
            <label style={lbl}>Nome do público</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} style={inp} placeholder="Ex.: Reativação Sul — out/26" />
            <label style={lbl}>Etiqueta / setor (opcional)</label>
            <input value={tag} onChange={(e) => setTag(e.target.value)} style={inp} placeholder="Ex.: Comercial" />
            <label style={lbl}>Arquivo CSV (UTF-8 ou Windows-1252)</label>
            <input type="file" accept=".csv,text/csv" onChange={aoEscolherArquivo} style={{ fontSize: 13 }} />
            <label style={lbl}>Ou cole telefones, um por linha ou separados por vírgula</label>
            <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={4}
              placeholder={"5588999999999\n5588888888888"}
              style={{ width: "100%", padding: 10, borderRadius: 9 }} />
            <button className="btn-ghost mini" type="button" onClick={lerNumerosColados}>Ler números colados</button>
            {(arquivo || contatos.length > 0) && (
              <div style={{ marginTop: 10, padding: "8px 11px", borderRadius: 9, background: "var(--surface-2)", fontSize: 13 }}>
                <b>{arquivo || "Números colados"}</b> — {contatos.length} linha(s): <span style={{ color: "var(--green)" }}>{unicos} válido(s)</span>
                {invalidos > 0 && <span style={{ color: "var(--amber)" }}> · {invalidos} sem telefone</span>}
                {contatos.length > 0 && <div style={{ marginTop: 5 }}>Nome: <b>{colunaNome || "coluna inferida"}</b> · Telefone: <b>{colunaTelefone || "coluna inferida"}</b></div>}
                {contatos.length > 0 && <div style={{ marginTop: 5 }}>Exemplos de nomes: {contatos.slice(0, 3).map((c) => c.name || "(sem nome)").join(" · ")}</div>}
                {colunas.length > 0 && <div style={{ marginTop: 5 }}>Colunas adicionais: {colunas.join(" · ")}</div>}
              </div>
            )}
            <button className="btn-mint" onClick={salvar} disabled={salvando || !validos.length} style={{ marginTop: 14, width: "100%", justifyContent: "center", padding: "10px" }}>
              {salvando ? "Salvando..." : "Salvar público"}
            </button>
            {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith("erro") ? "var(--red)" : "var(--text-dim)" }}>{msg}</div>}
          </div>

          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Públicos salvos ({publicos.length})</div>
            {publicos.length === 0
              ? <div style={{ color: "var(--text-faint)", fontSize: 13 }}>Nenhum público ainda. Suba um CSV ao lado.</div>
              : publicos.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--border-soft)" }}>
                  <Link href={`/publicos/${p.id}`} style={{ minWidth: 0, flex: 1, textDecoration: "none", color: "var(--text)" }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)" }}>
                      {p.contact_count} contato(s){p.tag ? <> · <span className="badge" style={{ fontSize: 10 }}>{p.tag}</span></> : null} · {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </div>
                  </Link>
                  <Link href={`/publicos/${p.id}`} className="btn-ghost mini">Abrir tabela</Link>
                  <button className="btn-ghost mini" style={{ color: "var(--red)" }} onClick={() => excluir(p.id, p.name)} title="Excluir">✕</button>
                </div>
              ))}
          </div>
        </div>

        <div style={{ marginTop: 18, padding: "10px 14px", borderRadius: 10, background: "var(--surface-2)", fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>
          <b>Disparar:</b> em <b>Campanha de Fluxo</b> escolha o fluxo → selecione o <b>Público salvo</b> → dispare.
          <br />Regra do CSV: identifique <b>nome + telefone</b>; todas as outras colunas são mantidas. Telefone sem DDI ganha o 55; duplicados são identificados antes de salvar.
        </div>
      </div>
    </>
  );
}
