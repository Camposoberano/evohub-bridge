"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const QUEUE = new Set(["queued", "running", "review"]);
const TERMINAL = new Set(["succeeded", "failed", "timeout", "skipped"]);

function fmtDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function pct(value) {
  if (value == null) return "-";
  return `${Math.round(value)}%`;
}

function p95(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx];
}

function hasMissingRelation(error) {
  if (!error) return false;
  const msg = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return error.code === "42P01" || msg.includes("relation") || msg.includes("does not exist");
}

function badgeTask(status) {
  if (status === "completed") return ["badge-green", "Concluida"];
  if (status === "running") return ["badge-amber", "Executando"];
  if (status === "review") return ["badge-gray", "Em revisao"];
  if (status === "queued") return ["badge-gray", "Na fila"];
  if (status === "failed") return ["badge-red", "Falhou"];
  return ["badge-gray", status || "-"];
}

function badgeRun(status) {
  if (status === "succeeded") return ["badge-green", "Sucesso"];
  if (status === "started") return ["badge-amber", "Em execucao"];
  if (status === "failed") return ["badge-red", "Falhou"];
  if (status === "timeout") return ["badge-red", "Timeout"];
  if (status === "skipped") return ["badge-gray", "Pulada"];
  return ["badge-gray", status || "-"];
}

export default function OrquestracaoPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState(null);
  const [models, setModels] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [runs, setRuns] = useState([]);

  const load = useCallback(async ({ silent } = { silent: false }) => {
    if (!silent) setLoading(true);

    const [mRes, tRes, rRes] = await Promise.all([
      supabase.from("llm_models")
        .select("id, provider, model_name, specialties, is_active, priority")
        .order("priority", { ascending: true }),
      supabase.from("llm_tasks")
        .select("id, title, area, risk_level, status, attempts, selected_primary, selected_reviewer, updated_at, finished_at")
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase.from("llm_runs")
        .select("id, task_id, model_id, role, status, attempt_no, latency_ms, started_at")
        .order("started_at", { ascending: false })
        .limit(250),
    ]);

    const errs = [mRes.error, tRes.error, rRes.error].filter(Boolean);
    if (errs.length > 0) {
      if (errs.some((item) => hasMissingRelation(item))) {
        setSchemaReady(false);
        setError("As tabelas de orquestracao ainda nao existem. Aplique a migration 0002_llm_orchestration.sql.");
      } else {
        setError(errs.map((item) => item.message).join(" | "));
      }
      setLoading(false);
      return;
    }

    setSchemaReady(true);
    setError("");
    setModels(mRes.data || []);
    setTasks(tRes.data || []);
    setRuns(rRes.data || []);
    setLastSync(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    let timer;
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (!data.session) {
        router.replace("/login");
        return;
      }

      setReady(true);
      load();
      timer = setInterval(() => load({ silent: true }), 8000);
    });

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [router, load]);

  const summary = useMemo(() => {
    const queueCount = tasks.filter((task) => QUEUE.has(task.status)).length;
    const completed24h = tasks.filter((task) => {
      if (task.status !== "completed") return false;
      const ts = task.finished_at || task.updated_at;
      if (!ts) return false;
      return Date.now() - new Date(ts).getTime() <= 24 * 60 * 60 * 1000;
    }).length;

    const terminalRuns = runs.filter((run) => TERMINAL.has(run.status) && run.status !== "skipped");
    const succeeded = terminalRuns.filter((run) => run.status === "succeeded");
    const successRate = terminalRuns.length ? (succeeded.length / terminalRuns.length) * 100 : null;

    const latencyP95 = p95(
      succeeded
        .map((run) => Number(run.latency_ms || 0))
        .filter((value) => Number.isFinite(value) && value > 0),
    );

    return { queueCount, completed24h, successRate, latencyP95 };
  }, [tasks, runs]);

  const modelMetrics = useMemo(() => {
    const byModel = new Map();
    for (const run of runs) {
      if (!run.model_id) continue;
      const bucket = byModel.get(run.model_id) || [];
      bucket.push(run);
      byModel.set(run.model_id, bucket);
    }

    return models.map((model) => {
      const rows = (byModel.get(model.id) || []).sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")));
      const terminal = rows.filter((run) => TERMINAL.has(run.status) && run.status !== "skipped");
      const succeeded = terminal.filter((run) => run.status === "succeeded");

      let streak = 0;
      for (const run of rows) {
        if (run.status === "failed" || run.status === "timeout") {
          streak++;
          continue;
        }
        if (run.status === "succeeded") break;
      }

      return {
        ...model,
        successRate: terminal.length ? (succeeded.length / terminal.length) * 100 : null,
        inQueue: tasks.filter((task) => QUEUE.has(task.status) && (task.selected_primary === model.id || task.selected_reviewer === model.id)).length,
        failureStreak: streak,
      };
    });
  }, [models, runs, tasks]);

  if (!ready) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Carregando...</div>;

  return (
    <div className="shell">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Orquestracao multi-LLM</div>
          <div style={{ color: "var(--text-dim)", fontSize: 14, marginTop: 4 }}>Fila, tentativas e saude dos modelos</div>
          <div style={{ color: "var(--text-faint)", fontSize: 12, marginTop: 6 }}>
            Ultima leitura: {lastSync ? lastSync.toLocaleTimeString("pt-BR") : "-"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/conexoes" className="btn-ghost">Voltar conexoes</Link>
          <button className="btn-mint" onClick={() => load()} disabled={loading}>{loading ? "Atualizando..." : "Atualizar"}</button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 14, borderColor: "rgba(226,80,74,.45)" }}>
          <div style={{ color: "#f08a85", fontWeight: 600 }}>Atencao</div>
          <div style={{ color: "var(--text-dim)", marginTop: 6 }}>{error}</div>
        </div>
      )}

      {!schemaReady ? (
        <div className="card">
          <div style={{ fontSize: 16, fontWeight: 600 }}>Painel indisponivel ate aplicar migration</div>
          <div style={{ color: "var(--text-dim)", marginTop: 6 }}>
            Aplique supabase/migrations/0002_llm_orchestration.sql para liberar a visualizacao.
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12, marginBottom: 14 }}>
            <div className="card">
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Tarefas na fila</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{summary.queueCount}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Concluidas (24h)</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{summary.completed24h}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Taxa de sucesso</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{pct(summary.successRate)}</div>
            </div>
            <div className="card">
              <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Latencia p95</div>
              <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4 }}>{summary.latencyP95 == null ? "-" : `${Math.round(summary.latencyP95)} ms`}</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Modelos</div>
            {modelMetrics.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>Nenhum modelo ativo em llm_models.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                {modelMetrics.map((model) => (
                  <div key={model.id} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{model.model_name}</div>
                    <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>{model.provider}</div>
                    <div style={{ marginTop: 10, display: "flex", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 700 }}>{pct(model.successRate)}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>sucesso</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 700 }}>{model.inQueue}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>na fila</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 17, fontWeight: 700 }}>{model.failureStreak}</div>
                        <div style={{ fontSize: 11, color: "var(--text-faint)" }}>falhas seguidas</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 8, color: "var(--text-dim)", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {(model.specialties || []).join(", ") || "sem especialidade"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Fila de tarefas</div>
            {tasks.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>Nenhuma tarefa registrada.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--text-faint)", fontSize: 12 }}>
                      <th style={{ padding: "8px 6px" }}>Titulo</th>
                      <th style={{ padding: "8px 6px" }}>Area</th>
                      <th style={{ padding: "8px 6px" }}>Status</th>
                      <th style={{ padding: "8px 6px" }}>Primario</th>
                      <th style={{ padding: "8px 6px" }}>Reviewer</th>
                      <th style={{ padding: "8px 6px" }}>Tentativas</th>
                      <th style={{ padding: "8px 6px" }}>Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => {
                      const [cls, label] = badgeTask(task.status);
                      return (
                        <tr key={task.id} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "10px 6px", fontSize: 13 }}>{task.title || "-"}</td>
                          <td style={{ padding: "10px 6px", fontSize: 13 }}>{task.area || "-"}</td>
                          <td style={{ padding: "10px 6px" }}><span className={`badge ${cls}`}>{label}</span></td>
                          <td style={{ padding: "10px 6px", fontSize: 13 }}>{task.selected_primary || "-"}</td>
                          <td style={{ padding: "10px 6px", fontSize: 13 }}>{task.selected_reviewer || "-"}</td>
                          <td style={{ padding: "10px 6px", fontSize: 13 }}>{task.attempts || 0}</td>
                          <td style={{ padding: "10px 6px", fontSize: 13, color: "var(--text-dim)" }}>{fmtDate(task.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>Tentativas recentes</div>
            {runs.length === 0 ? (
              <div style={{ color: "var(--text-dim)" }}>Nenhuma tentativa registrada.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                {runs.slice(0, 30).map((run) => {
                  const [cls, label] = badgeRun(run.status);
                  return (
                    <div key={run.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--surface-2)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{run.model_id || "-"}</div>
                        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
                          tarefa: {run.task_id} | papel: {run.role} | tentativa: {run.attempt_no}
                        </div>
                        <div style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 2 }}>{fmtDate(run.started_at)}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {run.latency_ms ? <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{Math.round(run.latency_ms)}ms</span> : null}
                        <span className={`badge ${cls}`}>{label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
