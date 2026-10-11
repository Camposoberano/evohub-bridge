# 5895 Immediate Opening and Price Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first n8n-authored 5895 funnel/price piece promptly and restore the confirmed 30/09 package values with editable menu content.

**Architecture:** The n8n action workflow enqueues the full lot, receives the first scheduled ID, then requests an immediate send of that persisted row. The bridge validates and transports it with the same delivery claims as the cron; the cron remains fallback. The price workflow owns the package list and captions, while the bridge only maps selections and records quotes.

**Tech Stack:** Deno/TypeScript bridge, Supabase scheduled_messages, n8n workflow SDK/MCP, WhatsApp 5895, Chatwoot.

**Spec:** `docs/superpowers/specs/2026-10-11-5895-resposta-imediata-precos-design.md`

## Global Constraints

- Channel only: official WhatsApp 5895; funnel version `mega-sorgo-5895-20260930`.
- Send window: 06:00–21:00 Fortaleza, preventive cutoff 20:55; never bypass provider window or commercial blocks.
- Prices: 2 kg R$ 179,90; 4 kg R$ 341,62; 10 kg R$ 764,15; 20 kg R$ 1.437,90.
- Do not send old promotion dates, previous prices, discount percentages or unconfirmed free shipping.
- Never send `v2-teste-meio-hectare-2kg.jpg` to a customer.

---

### Task 1: Return an eligible first piece and accept a secure immediate-send request

**Files:**
- Modify: `bridge/handlers/n8n-action-enqueue.ts`
- Create: `bridge/handlers/n8n-action-send-now.ts`
- Modify: `bridge/server.ts`
- Test: `bridge/tests/n8n-action-enqueue.test.ts` and a focused handler test for the new route

**Interfaces:**
- `POST /n8n-action-enqueue` adds `first_due_message_id: string | null` and `first_send_at: string | null` when the lot is newly accepted.
- `POST /n8n-action-send-now` consumes `{ scheduled_message_id, request_id, chatwoot_conversation_id }`, authenticated with `N8N_ACTION_SECRET`; returns `{ ok, sent, blocked?, uncertain? }`.

- [ ] **Step 1: Define the response contract.** Choose only row 0 if its `send_at <= now`, status pending, and the request was newly accepted. Duplicate responses return null ID.
- [ ] **Step 2: Add route tests.** Invalid secret, other channel, wrong request ID, future piece, duplicate, off-hours and blocked contact must produce no transport; one due piece can be sent once.
- [ ] **Step 3: Implement the route.** Read the row and conversation, compare its `payload.__funnel_sequence_id` against `actionKey(request)`, then use the same `funnel-queue-${id}` claim and `sendOutbound` body already used by `bridge/shared/funnel-queue.ts`. On `sent`, set `scheduled_messages.status=sent` and `sent_at`; on uncertain retain the no-resend protection; on retry/defer leave the cron a safe path.
- [ ] **Step 4: Register the route and type-check.** `deno check bridge/server.ts`; run only focused contract checks approved for this feature. Commit bridge changes.

### Task 2: Link n8n action workflows to immediate send

**Files:**
- Update n8n workflows `Gi816kZhzzlSZGbG` (main) and `LpIJzlfzIQVb6m1b` (price), then other content actions that start with a due piece.
- Document: `ops/n8n-soberano-5895-workflows.md`

**Interfaces:** The enqueue HTTP node passes the first due ID, request ID and Chatwoot conversation ID to a new conditional HTTP node calling `/n8n-action-send-now` with managed bearer credentials. A null ID ends successfully without sending.

- [ ] **Step 1: Inspect the n8n SDK reference and node types before edits.** Read the active graphs and identify existing credentials; do not print their values.
- [ ] **Step 2: Add the conditional immediate-send nodes.** Preserve the webhook response shape and current content nodes. The cron remains active and handles failures/remaining pieces.
- [ ] **Step 3: Validate and publish workflow versions.** Confirm all edited workflows remain active and a duplicate enqueue cannot start another send.

### Task 3: Publish the four-package price menu and replace test art

**Files:**
- Update n8n workflow `LpIJzlfzIQVb6m1b`, Code node `Artes e opções de preço`.
- Replace active `funnel_media` slot `preco_2kg` with a final visual derived from `ops/midias-rascunho-funil-2026-10-06/v2-teste-meio-hectare-2kg.jpg`.
- Review selection handling in `bridge/handlers/hub-webhook.ts` and `bridge/handlers/n8n-action-enqueue.ts`.

**Interfaces:** Initial `preco` request returns one list with four IDs. `selection=tam_*` returns one interactive piece with package art, current value and `preco_cotar_tam_*` / `preco_tamanho` buttons. Existing `quote_registered` reply and payment selections remain.

- [ ] **Step 1: Produce and visually inspect the 2 kg art.** Remove the red “OPÇÃO TESTE” banner; use only package and area on the image, with price in n8n text. Publish to a new storage object and switch the active slot after checking the URL.
- [ ] **Step 2: Edit the price Code node.** Initial list rows: `tam_2kg` (½ ha, R$ 179,90), `tam_4kg` (1 ha, R$ 341,62), `tam_10kg` (2 ha, R$ 764,15), `tam_20kg` (4 ha, R$ 1.437,90). The selected package has `header_media_ref` and two buttons. No expired promotion claims.
- [ ] **Step 3: Check the four selection outputs and publish.** Inspect active version, exercise the workflow content logic without sending to a customer, then perform the controlled real WhatsApp check within hours.

### Task 4: Deploy and observe

**Files:** `ops/n8n-soberano-5895-workflows.md`.

- [ ] **Step 1: Review the branch and merge the bridge PR.** Attach the PR, deploy the merge commit via Coolify and confirm `/health` and deployed commit.
- [ ] **Step 2: Observe a real ad lead or controlled test inside the send window.** Measure inbound detection to `sent_at`, inspect Chatwoot and receiving handset, and reconcile any uncertain provider result before retry.
- [ ] **Step 3: Record measured latency and remaining limitations.** The old “Promoção SAFRINHA” external sender remains a separate investigation until its source is found and disabled.

## Self-review

Each approved requirement has a task: immediate first piece (1–2), editable current price menu and valid art (3), deploy and real verification (4). Route and content types use `ActionRequest`, `actionKey` and existing selection IDs. No previous-price or promotion claim is included in the new content.
