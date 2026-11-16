# Async Video Receipt 5895 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Uazapi video send latency for scheduled restored 5895 funnel pieces while requiring one provider delivery receipt before marking sent.

**Architecture:** `send-outbound` passes its persisted attempt ID only for scheduled 5895 videos. `hybridSendMedia` sends those videos with `async:true` and a unique tracking ID, then waits briefly for a matching Delivered/Read/Played receipt. If no unique proof appears, the existing uncertain-delivery path and n8n reconciliation keep the sequence paused without a retry.

**Tech Stack:** Deno/TypeScript bridge, Uazapi HTTP API, Supabase, n8n.

**Spec:** `docs/superpowers/specs/2026-10-12-uazapi-video-async-5895-design.md`

## Global Constraints

- Only scheduled videos of `mega-sorgo-5895-20260930` on +55 19 99971-5895 use the new path.
- A `Queued` response never counts as sent. Confirm exactly one matching Delivered/Read/Played receipt.
- No automatic resend after an uncertain response. The published reconciliation remains the fallback.
- Do not log recipient, media URL, tokens, or message content in new diagnostics.

---

### Task 1: Receipt matching and waiting

**Files:**
- Create: `bridge/shared/async-video-receipt.ts`
- Test: `bridge/tests/async-video-receipt.test.ts`

**Interfaces:**
- Produce `waitForVideoReceipt(route, to, mediaUrl, trackId, providerId, startedAt, opts?)` returning a confirmed provider message or `null`; throw on lookup errors.
- Match only `fromMe`, video type, matching file, matching `track_id`, matching provider ID when supplied, Delivered/Read/Played, and a timestamp in the attempt window.

- [ ] Implement a pure `matchingAsyncVideoReceipt` predicate and bounded wait loop: query `/message/find` for the recipient at 2-second intervals for at most 20 seconds; accept exactly one matching receipt, reject an ambiguous match.
- [ ] Add focused cases for queued, wrong track ID/file/recipient/time, unique delivered, ambiguous delivered, and lookup error.
- [ ] Run the focused test and `deno check` for the new module.
- [ ] Commit the receipt helper.

### Task 2: Restrict async sending to the approved funnel

**Files:**
- Modify: `bridge/shared/hybrid.ts`
- Modify: `bridge/handlers/send-outbound.ts`
- Test: `bridge/tests/async-video-send.test.ts`

**Interfaces:**
- Add optional `asyncReceipt` to `hybridSendMedia` options with `trackId` and attempt start time.
- `send-outbound` passes it only when `type === "video"`, a scheduled row exists, `scheduledRow.funnel === "mega-sorgo-5895-20260930"`, channel phone digits equal `5519999715895`, and `attemptId` is present.

- [ ] Send `async:true`, `track_source:"evohub-5895-funnel"`, and `track_id` derived from the stored attempt ID for that narrow case.
- [ ] After HTTP 200, use Task 1's helper. Return success only with its confirmed receipt; otherwise throw `UncertainDeliveryError` so the existing queue writes `uncertain` and never falls back to another route.
- [ ] Record a safe transport stage such as `await_receipt` for the uncertain path; keep old behavior for other sends.
- [ ] Run focused cases and `deno check bridge/server.ts`.
- [ ] Commit implementation.

### Task 3: Publish and observe

**Files:**
- Modify: `ops/5895-auto-reconciliation.md`

- [ ] Document queued-versus-delivered semantics and safe operator actions.
- [ ] Review diff and open a PR; publish after review, using the already approved 5895 deployment route.
- [ ] Confirm bridge health, one real scheduled-video outcome or a controlled test to the previously authorized test number, and absence of a duplicate provider receipt.
- [ ] Confirm n8n queue/reconciliation executions and report any unresolved provider delay accurately.
