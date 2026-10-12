# Funil 5895: Reconciliação, alertas e diagnóstico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recuperar automaticamente envios incertos com recibo único, expor todo bloqueio real no n8n e medir os timeouts de mídia.

**Architecture:** O bridge mantém a prova e a mudança de estado em um módulo reutilizável, exposto por um endpoint restrito ao n8n. Um workflow cron separado chama esse endpoint; o workflow principal altera só a classificação do resultado. A mídia reutiliza o `HEAD` existente para colher tamanho sem consulta adicional.

**Tech Stack:** Deno/TypeScript, Supabase PostgREST/PostgreSQL, n8n, uazapi.

**Spec:** `docs/superpowers/specs/2026-10-12-5895-auto-reconciliation-alerts-media-design.md`

## Global Constraints

- Apenas WhatsApp 5895; sem reenvio de peças incertas.
- Recibo deve ser único, compatível com destinatário, tipo, conteúdo e horário, e ter status `Delivered`, `Read` ou `Played`.
- Janela de envio e reconciliação: 06h–21h de Fortaleza.
- Endpoint autenticado com `N8N_ACTION_SECRET`; nenhuma resposta com telefone, URL, token ou texto do cliente.

---

### Task 1: Núcleo de reconciliação segura

**Files:** Create `bridge/shared/reconcile-5895.ts`; modify `ops/reconcile-5895-uncertain.ts`; add focused tests under `bridge/tests/`.

**Interfaces:** `reconcile5895Uncertain({ limit, dryRun? })` returns counts and sanitized issue codes. It queries only failed uncertain rows of the restored 5895 funnel, validates channel and recipient, finds one provider receipt, updates the matching attempt conditionally, claims delivery and writes one event. The manual script calls the same core.

- [ ] Extract proof matching from the PR #10 script, including paginated `/message/find` and the three accepted statuses.
- [ ] Add a database compare-and-set operation for `(scheduled_message_id, attempt_id, failed)` so a concurrent worker cannot reconcile an unrelated attempt. Put claim/event in the same database operation where possible.
- [ ] Add tests for unique, none, ambiguous and concurrent receipts; assert zero provider sends.
- [ ] Run the focused tests and `deno check` on changed modules.
- [ ] Commit this independent bridge change.

### Task 2: Endpoint and n8n recovery workflow

**Files:** Create `bridge/handlers/n8n-reconcile-5895.ts`; modify `bridge/server.ts`; add auth/handler tests; create one n8n workflow.

**Interfaces:** `POST /n8n-reconcile-5895` requires bearer `N8N_ACTION_SECRET`, no body needed, returns `{checked,reconciled,unresolved,errors}` without identifiers. The workflow runs every minute in the business window and calls the endpoint using the existing bearer credential.

- [ ] Enforce method, bearer secret, channel and batch limit in the endpoint.
- [ ] Create the n8n cron workflow using the SDK/tool validation sequence and existing credential.
- [ ] Keep consultation errors visible as workflow errors while preserving failed rows.
- [ ] Test unauthorized calls and all outcome branches; inspect one live execution without sending a test message.
- [ ] Commit bridge changes and record n8n workflow ID in operations documentation.

### Task 3: Alert on every real queue block

**Files:** n8n workflow `pQFCtRhzQTKqXTjS`; operations documentation.

**Interfaces:** Keep the current temporary-result classification. Change the final node guard from `sent===0 && deduplicated===0 && blocked>0` to `blocked>0`, retaining counts/reasons in the error.

- [ ] Save the current active workflow version and code before editing.
- [ ] Update only the guard through the n8n atomic update operation; validate the node/workflow.
- [ ] Inspect an execution with mixed sent/blocked results and confirm it is marked error; inspect a temporary wait and confirm no false error.
- [ ] Record workflow version and outcome.

### Task 4: Media timeout diagnostics

**Files:** Modify `bridge/shared/midia-funil.ts`, `bridge/shared/uazapi.ts`, `bridge/handlers/send-outbound.ts`, `bridge/handlers/operational-health.ts`; focused tests.

**Interfaces:** Existing media probe retains the boolean API and exposes optional cached `Content-Length`; Uazapi response error retains stage/duration. Delivery events add `media_type`, `media_size_bytes` when known and a non-personal duration bucket. Health groups counts by type and bucket.

- [ ] Capture size from the existing HEAD without a second request or URL in logs/events.
- [ ] Include size/type and timeout stage/duration in sanitized delivery diagnostics.
- [ ] Expose aggregate counts in health; never include per-contact content.
- [ ] Run focused tests, typecheck and build checks requested for changed code.
- [ ] Commit the diagnostics change.

### Task 5: Release and observe

**Files:** Operations document and pull request.

- [ ] Review diff for secrets, cross-channel impact and accidental sends.
- [ ] Open PR with all code changes and attach it to this task.
- [ ] After merge/deploy, check bridge health, n8n executions, zero duplicates and provider receipts for real uncertain cases.
- [ ] Report any unresolved receipts separately; never retry them automatically.
