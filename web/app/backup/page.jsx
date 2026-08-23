"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";

const VERSION = {
  branch: "master",
  commit: "07b09ab",
  repository: "Camposoberano/evohub-bridge",
  date: "23/08/2026",
};

const CHECKLIST = [
  { title: "Código versionado", detail: "Repositório, Dockerfile, migrações e testes publicados no Git.", status: "Concluído", tone: "green" },
  { title: "Script de backup PostgreSQL", detail: "Pronto para executar quando SUPABASE_DB_URL estiver disponível.", status: "Pronto", tone: "blue" },
  { title: "Export alternativo via Supabase", detail: "Exporta tabelas operacionais sem interromper a aplicação.", status: "Pronto", tone: "blue" },
  { title: "Supabase Storage", detail: "Buckets identificados; exportação dos objetos ainda pendente.", status: "Pendente", tone: "amber" },
  { title: "Segredos e integrações", detail: "Inventário documentado; valores devem permanecer no cofre/Coolify.", status: "Pendente", tone: "amber" },
  { title: "Restauração de teste", detail: "Será executada somente quando houver uma VPS de homologação.", status: "Futuro", tone: "gray" },
];

const CHANGES = [
  { version: "07b09ab", date: "23/08/2026", title: "Preparação de backup e clonagem", detail: "Criados scripts, checklist, inventário de Storage e ordem de restauração." },
  { version: "cbbf4c6", date: "22/08/2026", title: "Etiquetas por campanha e bloqueio comercial", detail: "SUL na conclusão do funil; Pago exclui campanhas normais; Não COMPRA bloqueia permanentemente." },
  { version: "836c22d", date: "22/08/2026", title: "Correção de contatos legados", detail: "Contatos antigos com Não COMPRA também passam a receber bloqueio durável." },
  { version: "ba5198a", date: "22/08/2026", title: "Encerramento por desinteresse", detail: "Recusa explícita cancela filas, sequências e campanhas do contato." },
];

function Badge({ tone, children }) {
  return <span className={`backup-badge backup-badge-${tone}`}>{children}</span>;
}

export default function BackupPage() {
  const [copied, setCopied] = useState(false);
  const [bridge, setBridge] = useState({ state: "checking", build: "—", checkedAt: null });
  const command = "pwsh -File .\\ops\\backup-evohub.ps1";

  async function verificarBridge() {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch("/api/bridge-status", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      setBridge({
        state: response.ok && body.ok ? "online" : "degraded",
        build: body.build || "build não informado",
        checkedAt,
      });
    } catch {
      setBridge({ state: "offline", build: "indisponível", checkedAt });
    }
  }

  useEffect(() => { verificarBridge(); }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <Nav />
      <main className="shell backup-page">
        <header className="backup-header">
          <div>
            <div className="display backup-eyebrow">Operação protegida</div>
            <h1 className="display">Backup & Clonagem</h1>
            <p>Base organizada para duplicar a EvoHub quando uma nova VPS for aprovada.</p>
          </div>
          <Badge tone="green"><span className="pulse-dot pulse-green" /> Preparado</Badge>
        </header>

        <section className="callout backup-callout">
          <div className="callout-icon" aria-hidden>✓</div>
          <div>
            <strong>Instalação atual preservada</strong>
            <div>Esta área documenta e prepara a clonagem. Nenhuma ação aqui apaga dados ou altera a VPS atual.</div>
          </div>
        </section>

        <div className="backup-grid">
          <section className="card backup-version">
            <div className="section-title">Versão de referência</div>
            <div className="backup-version-row">
              <div>
                <div className="backup-version-name">EvoHub Bridge</div>
                <div className="backup-muted">Origem oficial para o próximo clone</div>
              </div>
              <Badge tone="blue">{VERSION.branch}</Badge>
            </div>
            <dl className="backup-dl">
              <div><dt>Commit</dt><dd><code>{VERSION.commit}</code></dd></div>
              <div><dt>Repositório</dt><dd>{VERSION.repository}</dd></div>
              <div><dt>Registrado em</dt><dd>{VERSION.date}</dd></div>
            </dl>
          </section>

          <section className="card">
            <div className="section-title">Ação preparada</div>
            <h2 className="backup-card-title">Gerar backup</h2>
            <p className="backup-muted">O comando gera o dump do banco e um manifesto local. Ele não deve ser executado durante uma migração sem conferir o destino.</p>
            <div className="backup-command"><code>{command}</code><button className="btn-ghost mini" onClick={copiar} title="Copiar comando" aria-label="Copiar comando">{copied ? "Copiado" : "Copiar"}</button></div>
            <div className="backup-note">O dump completo depende de <code>SUPABASE_DB_URL</code> configurada no ambiente seguro.</div>
          </section>
        </div>

        <section className="backup-section">
          <div className="section-heading-row"><div><div className="section-title">Preflight</div><h2 className="backup-card-title">Estado do ambiente atual</h2></div><button className="btn-ghost mini" onClick={verificarBridge}>Verificar agora</button></div>
          <div className="backup-runtime">
            <div className={`backup-runtime-state backup-runtime-${bridge.state}`}><span className="pulse-dot" />{bridge.state === "checking" ? "Verificando" : bridge.state === "online" ? "Bridge online" : bridge.state === "degraded" ? "Bridge com alerta" : "Bridge indisponível"}</div>
            <div><span>Build ativo</span><strong>{bridge.build}</strong></div>
            <div><span>Última leitura</span><strong>{bridge.checkedAt ? new Date(bridge.checkedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—"}</strong></div>
          </div>
        </section>

        <section className="backup-section">
          <div className="section-heading-row"><div><div className="section-title">Roteiro</div><h2 className="backup-card-title">Checklist de preparação</h2></div><span className="backup-muted">6 itens</span></div>
          <div className="backup-checklist">
            {CHECKLIST.map((item) => <div className="backup-check" key={item.title}><div className={`backup-check-icon backup-check-${item.tone}`}>{item.tone === "green" ? "✓" : "•"}</div><div className="backup-check-body"><strong>{item.title}</strong><span>{item.detail}</span></div><Badge tone={item.tone}>{item.status}</Badge></div>)}
          </div>
        </section>

        <section className="backup-section">
          <div className="section-title">Registro</div>
          <h2 className="backup-card-title">Modificações relevantes</h2>
          <div className="backup-history">
            {CHANGES.map((change) => <article className="backup-history-item" key={change.version}><div className="backup-history-meta"><code>{change.version}</code><span>{change.date}</span></div><div><strong>{change.title}</strong><p>{change.detail}</p></div></article>)}
          </div>
        </section>

        <section className="backup-section backup-next">
          <div><div className="section-title">Próxima etapa</div><h2 className="backup-card-title">Quando a nova VPS existir</h2><p>Restaurar o banco, recriar os buckets do Storage, configurar os segredos, validar o bridge e só então apontar o DNS. A origem permanece intacta durante toda a homologação.</p></div>
          <a className="btn-ghost" href="https://github.com/Camposoberano/evohub-bridge" target="_blank" rel="noreferrer">Abrir repositório ↗</a>
        </section>
      </main>
    </>
  );
}
