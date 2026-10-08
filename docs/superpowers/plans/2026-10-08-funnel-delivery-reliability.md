# Funnel delivery reliability implementation plan

**Design:** `docs/superpowers/specs/2026-10-08-funnel-delivery-reliability-design.md`
**Execution:** inline in the approved isolated worktree

## Implementation sequence

1. Add shared funnel delivery helpers for bounded attempt metadata, provider classification, event recording, backoff calculation, and status persistence using existing tables.
2. Update `/send-outbound` to validate scheduled-row state and lower steps; reject missing media; serialize send claims; persist sent/failed/retry/uncertain outcomes and return an explicit `sent` flag. Preserve safe behavior for manual sends without a scheduled row.
3. Update `pumpFunnelQueue` to advance only when `sent === true`, release its queue claim on retry/hold, and leave sender-owned retry/failure status intact. Ensure earlier pending/failed steps keep later rows held.
4. Update authenticated funnel operations and operational health with outcome/channel aggregates and ad first-step gaps; alert on failed or uncertain sends without exposing customer message contents.
5. Perform the historical/manual review last: summarize the already-audited failed rows and media evidence, identify what cannot be classified or safely replayed, and leave any re-send/restoration for an explicit operator decision.

## Verification

- Run `deno check bridge/server.ts` as a static/type check only; do not execute test suites unless requested.
- Inspect `git diff --check` and the final diff.
- Do not deploy, restore media, or replay customer sends as part of this implementation. Report deployment and historical/manual actions as separate next steps.

## Completion record

- Items 1–4 implemented in the isolated worktree, including send-time enforcement, stale-attempt quarantine, enrollment rollback, per-enrollment ordering, bounded 429 retries, media diagnostics, and channel-level operational reporting.
- Item 5 completed last as a historical audit report. No customer messages were replayed and no media was restored.
- Static verification passed: deno fmt, deno check bridge/server.ts, and git diff --check. No test suite was run.
- Production publication and deployment were not performed for this revision.
