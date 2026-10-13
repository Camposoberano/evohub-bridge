# Outcome Labels and Campaign Exclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit refusals and human confirmed payments visibly labeled and excluded from every future automated send in the 5895 channel.

**Architecture:** Keep the bridge database as the safety authority. A shared outcome operation cancels queued funnel and campaign sends first; a separate adapter mirrors no purchase labels to Chatwoot and WhatsApp. Existing preflight remains a final gate. The two label syncs reconcile manual labels and deliberate removal.

**Tech Stack:** Deno TypeScript, Supabase PostgREST, Chatwoot API, Uazapi.

**Spec:** `docs/superpowers/specs/2026-10-13-outcome-labels-campaign-stop-design.md`

## Global Constraints

- Never mark `pago` from text or AI; only a human applied label confirms payment.
- Stop scheduled funnel and campaign sends before external label writes.
- No customer messages or campaigns are sent during verification.
- Preserve preexisting labels in both interfaces.
- Do not replay `skipped` campaign entries or cancelled funnel steps after reactivation.

---

### Task 1: Recognize explicit refusal safely

**Files:** Modify `bridge/shared/negative-intent.ts`; modify `bridge/tests/negative-intent.test.ts`.

**Interfaces:** `isNegativeIntent(value: string | null | undefined): boolean`.

- [ ] Add assertions that “No momento não irei adquirir, obrigado” and “Não quero comprar agora” are true, while “Não sei o preço” and “Não quero atrapalhar” are false.
- [ ] Run `deno test --no-check bridge/tests/negative-intent.test.ts`; see the new positive assertions fail.
- [ ] Extend normalized patterns only for unambiguous purchase refusals and optional polite suffixes.
- [ ] Run the same test and confirm all pass; commit the focused change.

### Task 2: Make internal exclusion durable for every entry path

**Files:** Modify `bridge/shared/stop-contact.ts`, `bridge/handlers/funil-control.ts`, `bridge/handlers/sync-labels.ts`; create `bridge/tests/stop-contact.test.ts`.

**Interfaces:** `stopContactAutomation(db, channelId, externalContactId, reason)` and `excludePaidContact(db, channelId, externalContactId)` return counts; database errors throw. New shared helpers may accept a resolved contact to avoid repeating lookups.

- [ ] Add mock database tests for two conversations per contact: pending/paused steps and sales sequences cancel; pending/paused/processing campaign entries become `skipped`; paid gets `automation_excluded`, refusal gets `blocked`; no sent rows change; repeated execution is idempotent.
- [ ] Run `deno test --no-check bridge/tests/stop-contact.test.ts` and confirm the new tests fail.
- [ ] Check each Supabase mutation's `.error`, preserve `won` on a paid conversation, and update manual `marcar-pago`/`marcar-nao-compra` and Chatwoot label sync to invoke the shared operation using channel/contact lookup.
- [ ] Run the directed tests and commit.

### Task 3: Mirror no purchase labels and support deliberate removal

**Files:** Create `bridge/shared/commercial-outcome-labels.ts`, `bridge/tests/commercial-outcome-labels.test.ts`; modify `bridge/handlers/hub-webhook.ts`, `bridge/handlers/uazapi-webhook.ts`, `bridge/handlers/sync-labels.ts`, `bridge/handlers/sync-wa-labels.ts`, `bridge/shared/stop-contact.ts`.

**Interfaces:** `ensureNoPurchaseLabels(db, channelId, externalContactId)` returns `{chatwoot:boolean, whatsapp:boolean, errors:string[]}`. `reconcileNoPurchaseRemoval(db, contactId, labels)` clears only a confirmed no purchase block after both labels are absent.

- [ ] Write tests for Chatwoot existing-label preservation, Uazapi label ID lookup, repeated application, one API failing while internal block remains, and removal only after both visible labels had been confirmed.
- [ ] Run the directed test and confirm failure.
- [ ] Reuse `getConversationLabels`/`setConversationLabels` and `instGet('/labels')`/`instPost('/chat/labels')`. Mirror after DB exclusion; record each failure in `events`. Mark a contact attribute when both copies are confirmed. Both sync loops reconcile removal; no old queued work resumes.
- [ ] Run directed tests; commit.

### Task 4: Verify all entry routes and inspect production safely

**Files:** Extend directed tests for `funil-control`, label sync and inbound routing as needed.

- [ ] Cover free text refusal, WhatsApp no purchase label, Chatwoot no purchase label, Chatwoot paid label, WhatsApp paid label, and manual outcome commands; assert no customer send function is invoked.
- [ ] Run `deno test --no-check` on all changed test files, `deno check bridge/server.ts` after dependencies are installed, and `git diff --check`.
- [ ] Compare Supabase state for historical #3403 and paid #3509 without changing those contacts; use a dedicated test contact for any end-to-end label write. Verify Chatwoot and Uazapi visible labels and Supabase scheduled/campaign statuses. Do not dispatch messages.
- [ ] Commit final fixes; report test counts and any verification limits.
