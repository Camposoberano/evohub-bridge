# Restauração do funil de 30/09 no 5895 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar no 5895 a jornada multimídia de 30/09 sob um ID novo e migrar sem duplicação os leads afetados desde 06/10.

**Architecture:** O roteiro histórico volta como cinco fases no gerador de fila existente. `funnel-identity` escolhe a nova versão somente para o 5895; a fila, manutenção e controles reconhecem o novo ID. Uma operação com inventário e dry-run cancela somente futuros envios das versões erradas e matricula conversas elegíveis pela API publicada.

**Tech Stack:** Deno/TypeScript, Supabase PostgREST, Meta Cloud API, Chatwoot, Coolify.

**Spec:** `docs/superpowers/specs/2026-10-09-restauracao-funil-30-setembro-5895-design.md`

## Global Constraints

- Canal alvo: WhatsApp oficial 5895, ID `cf316d59-f6da-4683-adcc-29095a805dde`.
- Referência de conteúdo: commit `71f58b9` e fila da conversa #3123 de 30/09/2026.
- Novo ID: `mega-sorgo-5895-20260930`; ID `mega-sorgo-5895-v2` permanece histórico.
- Cinco fases, 31 etapas agendadas, dez áudios, quatro vídeos; sem vídeo na fase 5.
- Gaps `[0,1800,21600,43200,43200]` segundos de tempo comercial, duração de fase 560 segundos, peças separadas por pelo menos 70 segundos, janela 06h–22h Fortaleza.
- Preço e dúvidas não pausam a nova sequência; compra, recusa, atendimento humano, fechamento em andamento e intervenção manual conservam os bloqueios existentes.
- Falha de mídia não pode concluir a sequência como entregue ou avançar a peça seguinte.
- Envio confirmado pelo provedor é distinto de recibo `delivered`/`read` no aparelho.
- Não enviar campanhas em massa; migração apenas de conversas de anúncio elegíveis do 5895 abertas desde 06/10.

---

### Task 1: Identidade e roteiro histórico

**Files:**
- Modify: `bridge/shared/funnel-identity.ts`
- Modify: `bridge/handlers/funil-enroll.ts`
- Modify: `bridge/tests/funil-five-moments.test.ts`, `bridge/tests/funil-offsets.test.ts`, `bridge/tests/funnel-identity.test.ts`

**Interfaces:** Produces `RESTORED_5895_FUNNEL`, `MAIN_FUNNELS`, `FASES` with original pieces, and `mainFunnelForChannel()` selecting the restored ID. Media is still read from catalog `mega-sorgo`.

- [ ] Step 1: Replace the obsolete five-text assertions with exact phase lengths `[7,5,5,6,8]`, ordered types, old copy anchors, button IDs, `FIM_ACESSO===560`, and new identity. Run focused tests and observe failures.
- [ ] Step 2: Add `RESTORED_5895_FUNNEL = "mega-sorgo-5895-20260930"`; `MAIN_FUNNELS` contains old, `v2`, restored. Select restored for 5895 while preserving historical labels.
- [ ] Step 3: Restore `closingList(gancho)`, `fase1`–`fase5` copy and buttons from `git show 71f58b9:bridge/handlers/funil-enroll.ts`; use `FASES=[fase1,...,fase5]` and `FIM_ACESSO=560`. Remove the unused phase-5 video item so the active catalog yields exactly 31 rows. Require media for all other media/header slots and return a visible error if a slot is missing.
- [ ] Step 4: Run `deno test -A bridge/tests/funil-five-moments.test.ts bridge/tests/funil-offsets.test.ts bridge/tests/funnel-identity.test.ts` and `deno check --node-modules-dir=none bridge/server.ts`; inspect the diff against `71f58b9`, and commit.

```ts
export const RESTORED_5895_FUNNEL = "mega-sorgo-5895-20260930";
export const MAIN_FUNNELS = [LEGACY_MAIN_FUNNEL, AD_5895_FUNNEL, RESTORED_5895_FUNNEL];
export const FASES = [fase1, fase2, fase3, fase4, fase5];
export const FIM_ACESSO = 560;
```

### Task 2: Cliques, intenção e controle manual

**Files:**
- Create: `bridge/shared/restored-funnel-buttons.ts`
- Modify: `bridge/handlers/hub-webhook.ts`
- Modify: `bridge/shared/funnel-state.ts`
- Modify: `bridge/handlers/funil-control.ts`
- Create: `bridge/tests/restored-funnel-buttons.test.ts`
- Modify: `bridge/tests/funil-anuncio.test.ts`

**Interfaces:** Consumes `RESTORED_5895_FUNNEL`; produces a pure mapping from every `f1_*`–`f5_*` ID to response/recording behavior. `autoPauseFunil` leaves the restored sequence running for routine inbound and commercial intent, preserving explicit human/terminal pauses.

- [ ] Step 1: Add focused failing cases for every historical button, price during the opening, subsequent routine inbound, human handoff, repeat manual `iniciar`, and status counts.
- [ ] Step 2: Route old button IDs through `handleMenuClick` to short acknowledgements or existing menu handlers, log the choice, and never start a phase early. `f5_sim` uses `menu_preco`; `f5_local` asks for cidade/CEP; the other IDs acknowledge their answer or announce the next scheduled topic. Preserve the historical button IDs and labels in the outgoing payload.
- [ ] Step 3: In `autoPauseFunil`, bypass `resposta_cliente` and informational/commercial intent for the restored ID. Preserve pauses for `comPrazo:false`, `fechamento`, catalog navigation and manual actions. Adjust the first-phase completion check for seven rows.
- [ ] Step 4: Make `funil-control` report new-ID queue status and use `mega-sorgo` as media catalog for status; run `deno test -A bridge/tests/funil-anuncio.test.ts bridge/tests/restored-funnel-buttons.test.ts`, then commit.

```ts
if (funnel === RESTORED_5895_FUNNEL && isRoutineFunnelIntent(reason, opts)) return false;
// `menu_preco` answers immediately; the scheduled phase rows stay pending.
```

### Task 3: Fila, manutenção e observabilidade

**Files:**
- Modify: `bridge/shared/funnel-queue.ts`, `bridge/shared/funnel-recovery.ts`, `bridge/shared/recovery-chain.ts`
- Modify: `bridge/handlers/operational-health.ts`, `bridge/handlers/funnel-ops.ts`
- Modify: `bridge/shared/completion-label.ts`, `bridge/server.ts`
- Modify focused tests in `bridge/tests/`

**Interfaces:** Consumes `MAIN_FUNNELS` and `RESTORED_5895_FUNNEL`. Producer queue rejects pending historical IDs on 5895, dispatches restored rows in step order, and keeps a failed media row visible. Maintenance and reports select the restored ID.

- [ ] Step 1: Add failing identity/queue/maintenance cases: old pending row on 5895 cancelled, restored row sent, failed video blocks later step and remains reported.
- [ ] Step 2: Replace hardcoded two-ID filters with `MAIN_FUNNELS`; ensure maintenance does not label a sequence complete while a failed row remains unresolved. Update completion-label defaults and monitoring to new ID.
- [ ] Step 3: Keep existing provider failure metadata and add any missing provider error/attempt fields to recorded events without exposing tokens, full media URLs or customer phone numbers. Bump `/version` build marker.
- [ ] Step 4: Run `deno test -A bridge/tests/funnel-identity.test.ts bridge/tests/funnel-recovery.test.ts bridge/tests/funnel-schedule.test.ts` and `deno check --node-modules-dir=none bridge/server.ts`; inspect status/error branches, commit.

```ts
.in("funnel", MAIN_FUNNELS)
// Stop after a failed predecessor; report `failed` and provider details for repair.
```

### Task 4: Inventário, publicação e migração

**Files:**
- Create: `ops/restore-funnel-5895-20260930.ts`
- Create: `ops/restore-funnel-5895-20260930.md` (counts and redacted evidence)

**Interfaces:** The script reads channel 5895 conversations since `2026-10-06T03:00:00Z`, computes ad evidence and terminal exclusions, prints a dry-run manifest, then cancels only pending/paused old/v2 rows and calls the published `/funil-control` for one new enrollment per eligible conversation. A rerun recognizes the restored sequence and skips it.

- [ ] Step 1: Build and review the dry-run manifest: conversation ID, version received, future row count, block reason, and new enrollment eligibility. Include #3509 explicitly; omit phone numbers and names.
- [ ] Step 2: Verify local typecheck and relevant focused tests; commit code and inventory script. Push this branch commit to the production `main` after checking remote HEAD, trigger the configured Coolify deploy, and confirm `/version` and `/health`.
- [ ] Step 3: Enroll one authorized conversation first. Confirm the first rows and first video with a provider message ID; on rejection preserve the error and repair media/protocol before the bulk.
- [ ] Step 4: Run the migration script for eligible Oct6–9 conversations with idempotency and report exact counts for enrolled, excluded, pending and failed. Verify a sample of the new queue has 31 rows and the `v2` has no future rows.
- [ ] Step 5: Monitor the queue and report acceptance versus device delivery accurately. Commit the redacted operations report.

```ts
const SINCE = "2026-10-06T03:00:00Z";
const OLD = ["mega-sorgo", "mega-sorgo-5895-v2"];
// apply: update OLD pending/paused -> cancelled, then POST /funil-control {action:"funil",chatwoot_conversation_id:id}
// rerun: a `mega-sorgo-5895-20260930` sequence means skip.
```
