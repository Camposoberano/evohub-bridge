# Projeto 1 - Contrato tecnico de orquestracao multi-LLM (v1)

## Objetivo

Criar um fluxo com 3 LLMs ou mais, com especializacao por tarefa, fallback automatico e revisao cruzada.

## Resultado esperado

1. Sem bloqueio quando um provider ficar sem quota.
2. Troca de modelo sem perder contexto.
3. Menos erro repetido na mesma categoria de tarefa.
4. Trilha auditavel de decisao, custo, latencia e qualidade.

## Acoplamento com este repositorio

1. Bridge Deno decide rota e persiste tentativas.
2. Supabase guarda tarefas, runs, handoff e quality gates.
3. Web/Next mostra fila e saude dos modelos.

Arquivos centrais:

1. bridge/shared/llm-orchestrator.ts
2. bridge/handlers/llm-orchestrate.ts
3. supabase/migrations/0002_llm_orchestration.sql
4. web/app/orquestracao/page.jsx

## API da bridge

Endpoint:

1. POST /llm-orchestrate

Autenticacao:

1. Header Authorization: Bearer <LLM_ROUTER_API_TOKEN> quando o token estiver configurado.

### Modo route

Cria llm_task + primeira llm_run com status started.

```json
{
  "mode": "route",
  "external_ref": "ticket-42",
  "area": "frontend_visual",
  "risk": "high",
  "title": "Refinar tela de conexoes",
  "objective": "melhorar UX sem regressao funcional",
  "payload": { "files": ["web/app/conexoes/page.jsx"] },
  "requires_review": true,
  "blocked_model_ids": ["cloud_arch"]
}
```

### Modo attempt

Registra tentativa, atualiza status da tarefa, opcionalmente grava gates e handoff.

```json
{
  "mode": "attempt",
  "task_id": "<uuid>",
  "model_id": "codex_exec",
  "role": "primary",
  "status": "succeeded",
  "attempt_no": 2,
  "latency_ms": 8100,
  "total_tokens": 5200,
  "gates": {
    "lint": "pass",
    "build": "pass",
    "tests": "pass",
    "security": "na"
  }
}
```

## Contrato de handoff

Nenhuma troca de modelo deve ocorrer sem handoff.

Campos minimos:

1. taskId
2. objective
3. completedSteps
4. pendingSteps
5. failures
6. nextAction
7. gates

## Politica de roteamento

Formula base de score:

score = 0.40*especialidade + 0.25*disponibilidade + 0.15*historico + 0.10*latencia + 0.10*custo

Regras:

1. risk high força reviewer, quando houver.
2. Falhas consecutivas removem modelo do pool preferencial.
3. Quota/timeout move para fallback.
4. Reviewer pode reprovar e abrir nova tentativa.

## Quality gates

1. lint
2. build
3. tests
4. security

## SLOs iniciais

1. Sucesso por tarefa >= 90%.
2. Fallback sem bloqueio manual >= 95%.
3. Reducao de retrabalho >= 30%.
4. Latencia p95 por tentativa <= 25s.

## Roadmap de implantacao

1. Aplicar migration 0002 e seeds de modelo.
2. Integrar chamada do endpoint /llm-orchestrate no fluxo operacional.
3. Instrumentar quality gates por tentativa.
4. Monitorar dashboard /orquestracao e ajustar pesos.
