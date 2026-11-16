# Durable Video Receipts 5895 Implementation Plan

> **For agentic workers:** Use the executing-plans skill to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Persist Uazapi delivery events reliably, reconcile confirmed 5895 video receipts promptly, and expose stuck videos in operations.

**Architecture:** The authenticated webhook first awaits event persistence. A small receipt handler extracts confirmed provider message IDs and finds the matching uncertain scheduled video, then reuses the existing strict provider-history reconciliation and conditional update. The minute cron remains a recovery path. The existing funnel operations and health endpoints expose age and counts.

**Tech Stack:** Deno/TypeScript bridge, Supabase PostgREST, Uazapi, Next.js operations panel.

**Spec:** `docs/superpowers/specs/2026-10-12-durable-video-receipts-5895-design.md`

## Global constraints

- Only scheduled videos of `mega-sorgo-5895-20260930` on WhatsApp 5895 receive immediate status reconciliation.
- A single `Delivered`, `Read`, or `Played` provider receipt is required; `Sent` remains uncertain.
- Never resend an uncertain or confirmed piece and never trigger a test message to a customer.
- Never put phone, token, content, or media URL in operational diagnostics.
- Production send window remains 06h–21h Fortaleza.

---

### Task 1: Make webhook persistence durable

**Files:** Modify `bridge/handlers/uazapi-webhook.ts`.

- [ ] Await the `events` insert and inspect its error before replying `200`.
- [ ] On persistence failure, log only a safe error category and respond `503` so the provider can retry; do not start inbound work.
- [ ] Preserve existing event label and redaction behavior.
- [ ] Check Deno types and inspect the diff.

### Task 2: Reconcile confirmed video receipt from the webhook

**Files:** Modify `bridge/handlers/uazapi-webhook.ts`, `bridge/shared/reconcile-5895.ts`; create `bridge/shared/uazapi-video-status.ts` if parsing needs an isolated unit.

- [ ] Parse `ReadReceipt` with `event.Type` and `event.MessageIDs`; accept only `Delivered`, `Read`, or `Played`. Handle `messages_update` when an equivalent status and message ID exist.
- [ ] Identify only failed/uncertain scheduled videos from the restored 5895 funnel associated with the receipt's chat/instance. Avoid a lookup for unrelated updates.
- [ ] Query `/message/find` and require the existing strict match (recipient, video URL, `track_id`, attempt time, and unique provider message ID). Use the conditional row update already present in reconciliation.
- [ ] Dispatch the focused check after the durable insert; keep the minute cron as fallback. An error leaves the row unchanged and is logged without personal data.
- [ ] Check Deno types and inspect the diff.

### Task 3: Show unconfirmed videos and alert

**Files:** Modify `bridge/handlers/funnel-ops.ts`, `web/app/funil/page.jsx`, `bridge/handlers/operational-health.ts`, `bridge/shared/operational-alert.ts`.

- [ ] Return the timestamp and age of an uncertain `await_receipt` video in the existing safe failure DTO.
- [ ] Render status `Sent sem confirmação`, elapsed minutes, conversation link, and no retry control in the funnel panel.
- [ ] Count 5895 uncertain videos older than five minutes in the monitor and register a dedicated critical alert with a count only.
- [ ] Check Deno types, panel build, and inspect the diff.

### Task 4: Publish and observe real sends

**Files:** No product file required.

- [ ] Commit the code and create a reviewable PR; merge and deploy according to the existing authorized production workflow.
- [ ] Confirm the bridge health endpoint and the funnel panel load after deployment.
- [ ] Read queue states, webhook events, n8n executions, and provider receipts for real due videos. Record due/confirmed/unconfirmed counts, receipt latency, recon source, duplicates, and blocked pieces.
- [ ] Leave uncertain sends untouched and report any remaining provider `Sent` cases separately.
