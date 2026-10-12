# Unconfirmed Video Followups 5895 Implementation Plan

> **For agentic workers:** Implement the tasks sequentially in the current isolated worktree.

**Goal:** Continue the 5895 funnel after one verified `Sent` video copy remains without a delivery receipt for ten minutes.

**Architecture:** Reconciliation records a narrowly scoped release flag on the failed video. Both outbound gates honor that flag for the same funnel and sequence. Operations display the unresolved video and alert its conversation, while reconciliation keeps watching for a later confirmed receipt.

**Tech Stack:** Deno/TypeScript bridge, Supabase PostgREST, Uazapi, React dashboard, n8n.

**Spec:** `docs/superpowers/specs/2026-10-12-unconfirmed-video-followups-5895-design.md`

## Global Constraints

- Never resend an uncertain video automatically.
- Never label a `Sent` provider copy as delivered.
- Zero or multiple matching copies keep the sequence blocked.
- Only the approved 5895 funnel and its async videos qualify.

## Tasks

- [ ] Add strict provider copy matching, ten minute eligibility, compare-and-set release and event to reconciliation.
- [ ] Make scheduled outbound and manual retry gates honor only the scoped release flag.
- [ ] Show the release status in the failure panel and conversation IDs in the operational alert.
- [ ] Review the diff and publish; verify the affected conversation, provider copy count and n8n executions without sending a test message.
