"use client";
import { formatFortaleza } from "@/lib/campaign-monitoring.mjs";

export default function CampaignFlowProgress({ steps }) {
  return <section className="card" style={{ padding: 18, marginTop: 16 }}>
    <h3 style={{ margin: "0 0 6px" }}>Andamento observado no fluxo</h3>
    <p style={{ marginTop: 0, fontSize: 12, color: "var(--text-dim)" }}>
      Esta posição descreve o fluxo. Entrega e resposta são confirmadas separadamente.
    </p>
    {steps?.length ? <div style={{ display: "grid", gap: 8 }}>
      {steps.map((step) => <div key={step.stepId} style={{ border: "1px solid var(--border-soft)", borderRadius: 10, padding: 12,
        display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <strong>{step.stepId === "fim" ? "Fluxo concluído" : step.stepId === "sem etapa" ? "Etapa não registrada" : step.stepId}</strong>
        <span>{step.total} contato(s) · {step.waiting} aguardando
          {step.done ? ` · ${step.done} concluído(s)` : ""}</span>
        <small style={{ color: "var(--text-dim)" }}>Última mudança: {formatFortaleza(step.lastMovedAt)}</small>
      </div>)}
    </div> : <p style={{ color: "var(--text-faint)" }}>Sem posição registrada.</p>}
  </section>;
}
