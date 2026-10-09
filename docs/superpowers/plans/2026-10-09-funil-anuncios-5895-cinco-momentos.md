# Funil de anúncios 5895 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Replace the two-message ad opening with five short scheduled touches
for new WhatsApp 5895 ad leads, while direct answers run between touches and
never erase the remaining sequence.

**Architecture:** Keep enrollment, day/step queue creation, and copy in
`funil-enroll.ts`; keep direct intent handling in the existing WhatsApp
handlers; change pause/resume so an answered ad lead preserves all future
touches. Keep each scheduled touch to one text row and scope automatic
enrollment to the existing 5895 ad-origin checks.

**Tech Stack:** Deno, TypeScript, PostgREST through the existing `admin()`
client, Deno tests, Coolify deployment, `/health` and `/version` verification.

**Spec:**
`docs/superpowers/specs/2026-10-09-funil-anuncios-5895-cinco-momentos-design.md`

## Global Constraints

- Apply automatic enrollment only to new ad leads on WhatsApp channel 5895; any
  manual enrollment on 5895 must also use the new five-touch copy.
- Queue exactly five scheduled funnel sends, one short text per moment.
- Use the current working-time gaps (`0`, `30 min`, `6 h`, `12 h`, `12 h`) and
  the 06h–22h BRT window.
- A direct price, use, planting, or other intent response must not mark the
  sequence complete or cancel future moments.
- Respect opt-out, confirmed sale, contact blocks, and manual pause; an active
  human handoff may pause but must not erase the sequence.
- Do not add numeric prices, discount percentages, or unvalidated
  technical/logistics claims to scheduled copy.
- Do not automatically enroll historical conversations or resend already
  delivered messages.
- Never use the legacy five phases for new ad enrollments.

---

## File Map

- `bridge/handlers/funil-enroll.ts`: five message builders, phase schedule, and
  enrollment queue creation.
- `bridge/handlers/funil-control.ts`: accurate delivery wording for the manual
  start command.
- `bridge/shared/funnel-state.ts`: temporary pause behavior when the lead
  replies during the first scheduled moment.
- `bridge/handlers/uazapi-webhook.ts`: immediate intent response followed by
  preservation/pause of the ad sequence.
- `bridge/handlers/hub-webhook.ts`: shared commercial response text used by
  interactive and text price routes.
- `bridge/shared/funil-comercial.ts`: common price-condition text.
- `bridge/shared/funil-anuncio.ts`: channel scope, ad-origin,
  historical-enrollment, and pause decisions.
- `bridge/server.ts`: public build marker and feature identifier.
- `bridge/tests/funil-five-moments.test.ts`: active funnel count,
  one-text-per-moment, and copy guardrails.
- `bridge/tests/funil-anuncio.test.ts`: ad-origin enrollment and full-queue
  behavior.
- `bridge/tests/funil-pausa.test.ts`: temporary pause and resume behavior
  without queue cancellation.
- `bridge/tests/funil-comercial.test.ts`: package mapping and safe
  price-condition copy.

## Task 1: Replace the active two-piece phase with five one-text moments

**Files:**

- Create: `bridge/tests/funil-five-moments.test.ts`
- Modify: `bridge/handlers/funil-enroll.ts`
- Test: `bridge/tests/funil-five-moments.test.ts`,
  `bridge/tests/funil-offsets.test.ts`

**Interfaces:**

- Consumes: exported `FASES`, `FIM_ACESSO`, and `iniciosDosAcessos` from
  `funil-enroll.ts`.
- Produces: `FASES` with five builders; each builder returns exactly one
  `{ kind: "text" }` piece with a stable day index.

- [ ] **Step 1: Add a failing five-moment test**

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { FASES } from "../handlers/funil-enroll.ts";

Deno.test("funil ativo tem cinco momentos com uma mensagem de texto cada", () => {
  assertEquals(FASES.length, 5);
  const momentos = FASES.map((fase) => fase());
  assertEquals(momentos.map((fase) => fase.length), [1, 1, 1, 1, 1]);
  assertEquals(momentos.flatMap((fase) => fase.map((peca) => peca.kind)), [
    "text",
    "text",
    "text",
    "text",
    "text",
  ]);
  assertEquals(
    momentos.flatMap((fase) => fase).filter((peca) =>
      "opening" in peca && peca.opening
    ).length,
    0,
  );
});
```

- [ ] **Step 2: Run the focused test and verify it fails on the current
      two-piece phase**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-five-moments.test.ts`

Expected: FAIL because active `FASES` currently has one builder and two pieces.

- [ ] **Step 3: Replace `faseComercialV2` as the active `FASES` source**

Create five concise text builders from the approved spec: introduction; intended
use; missing locality/context; approved area-to-weight reference; final
quote/help CTA. Keep `faseComercialV2` out of `FASES`; do not wire
`FASES_LEGADAS` back into enrollment. Ensure the scheduled text does not include
a numeric price, a discount percent, or unvalidated agronomic/logistics
promises. Compute the inter-phase spacing from the new one-piece stages so the
configured business-time gaps remain the actual pauses between touches.

- [ ] **Step 4: Run phase and timing tests**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-five-moments.test.ts bridge/tests/funil-offsets.test.ts`

Expected: PASS with five one-text moments and existing business-hour bounds.

- [ ] **Step 5: Commit the five-moment sequence**

```bash
git add bridge/handlers/funil-enroll.ts bridge/tests/funil-five-moments.test.ts
git commit -m "feat: replace two-message ad funnel"
```

## Task 2: Preserve the five moments while intent replies run

**Files:**

- Modify: `bridge/handlers/funil-enroll.ts`
- Modify: `bridge/shared/funnel-state.ts`
- Modify: `bridge/handlers/uazapi-webhook.ts`
- Modify: `bridge/handlers/hub-webhook.ts`
- Modify: `bridge/shared/funil-anuncio.ts`
- Test: `bridge/tests/funil-anuncio.test.ts`,
  `bridge/tests/funil-pausa.test.ts`,
  `bridge/tests/missing-opening-recovery.test.ts`

**Interfaces:**

- Consumes: `AutoEnrollResult.adOrigin`, the existing direct intent handlers,
  and the existing temporary pause marker.
- Produces: an ad-origin reply can pause pending sends, run its existing
  handler, then resume the same remaining queue; it cannot turn the sequence
  into `replied` or `cancelled`.

- [ ] **Step 1: Add failing tests for price-intent enrollment and queue
      preservation**

Add `deveAdiarPausaDaAbertura(hasPendingOpeningMessages, adOrigin)` to
`funil-anuncio.ts` and test its decision table in `funil-anuncio.test.ts`:

```ts
assertEquals(deveAdiarPausaDaAbertura(true, true), false);
assertEquals(deveAdiarPausaDaAbertura(true, false), true);
assertEquals(deveAdiarPausaDaAbertura(false, true), false);
```

The five active pieces must have no `opening: true` flag, so `skipOpening`
cannot remove a funnel moment.

- [ ] **Step 2: Run the focused tests and verify the current behavior is not
      covered or fails**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-anuncio.test.ts bridge/tests/funil-pausa.test.ts bridge/tests/missing-opening-recovery.test.ts`

Expected: the new queue-preservation assertions fail against the current
`skipOpening`/opening-pause guard.

- [ ] **Step 3: Keep every scheduled ad moment when `skipOpening` is requested**

In the queue builder, remove `opening: true` from all five new scheduled pieces.
Keep `skipOpening` compatibility for historical/manual payloads, but ensure it
cannot filter any active ad moment. Preserve the direct handler path for
recognized price, usage, planting, and other intents; those answers must not be
held until a generic multi-message opening.

When there is no existing sequence, allow automatic enrollment only if this is
the lead's first inbound message. Keep existing sequences eligible for their
direct response route, and leave historical conversations without a sequence
untouched.

- [ ] **Step 4: Pause and resume without cancelling the ad queue**

Add `adOrigin?: boolean` to the `autoPauseFunil` options. Use
`deveAdiarPausaDaAbertura()` so the existing opening guard remains for other
flows but does not block a reply pause for the 5895 ad sequence. Keep the
pending rows by setting their status to `paused`; do not set them to `cancelled`
or mark the sequence `replied`. Let the existing timed pause resume the same row
IDs after the configured quiet period. Preserve indefinite manual/human pause
and terminal opt-out/sale/block behavior. Pass `enrollment?.adOrigin` from the
WhatsApp text-intent handler and verify ad origin from the stored conversation
before pausing a menu-click route.

- [ ] **Step 5: Run the focused pause, recovery, and enrollment tests**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-anuncio.test.ts bridge/tests/funil-pausa.test.ts bridge/tests/missing-opening-recovery.test.ts bridge/tests/funil-offsets.test.ts`

Expected: PASS; the price response is independent, all remaining funnel rows are
still pending or paused, and recovery does not duplicate a sequence.

- [ ] **Step 6: Commit the reply/interleaving behavior**

```bash
git add bridge/handlers/funil-enroll.ts bridge/shared/funnel-state.ts bridge/handlers/uazapi-webhook.ts bridge/handlers/hub-webhook.ts bridge/shared/funil-anuncio.ts bridge/tests/funil-anuncio.test.ts bridge/tests/funil-pausa.test.ts bridge/tests/missing-opening-recovery.test.ts
git commit -m "fix: preserve ad funnel after customer intent"
```

## Task 3: Remove the stale discount statement from price replies

**Files:**

- Modify: `bridge/shared/funil-comercial.ts`
- Modify: `bridge/handlers/hub-webhook.ts`
- Test: `bridge/tests/funil-comercial.test.ts`

**Interfaces:**

- Consumes: `textoCondicaoComercial()` and the existing package/quote handlers.
- Produces: the price route continues to show the approved package mapping and
  directs exact conditions to Cícero without asserting the conflicting 30%
  figure.

- [ ] **Step 1: Change the price test to reject the unsupported 30% copy**

In `funil-comercial.test.ts`, replace `assertEquals(copy.includes("30%"), true)`
with assertions that `copy.includes("30%")` is false and that the copy still
says the exact quote is confirmed by Cícero.

- [ ] **Step 2: Run the commercial copy test and verify it fails**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-comercial.test.ts`

Expected: FAIL because `textoCondicaoComercial()` and the price-choice text
currently say “30%”.

- [ ] **Step 3: Use neutral price-condition copy until rates are confirmed**

Remove the 30% promise from `textoCondicaoComercial()` and every price-selector
response in `hub-webhook.ts`. Keep the existing package map and freight
statement only where operationally confirmed; state that Cícero confirms the
current quote for quantity and region. Do not replace 30% with another
percentage in this change.

- [ ] **Step 4: Run price and package tests**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-comercial.test.ts bridge/tests/hybrid-menu.test.ts`

Expected: PASS; packages still map correctly, no numeric price or discount
percentage is added, and the price response remains routable.

- [ ] **Step 5: Commit the corrected price copy**

```bash
git add bridge/shared/funil-comercial.ts bridge/handlers/hub-webhook.ts bridge/tests/funil-comercial.test.ts
git commit -m "fix: remove stale discount promise from price replies"
```

## Task 4: Retire queued two-piece sends and publish the new build

**Files:**

- Modify: `bridge/server.ts`
- Test: `bridge/tests/funil-five-moments.test.ts` and the focused test groups
  above
- Production records: only pending/paused legacy rows confirmed on channel 5895

**Interfaces:**

- Consumes: five-moment enrollment and reply preservation from Tasks 1–3.
- Produces: no old two-piece row remains eligible to send on 5895; the active
  service identifies the new build and health checks pass.

- [ ] **Step 1: Update the build marker**

Set the public build name to `2026-10-09-funil-anuncios-5895-cinco-momentos` and
list only the new 5895 funnel behavior as the feature marker.

- [ ] **Step 2: Audit and cancel only confirmed old queued rows**

Use read-only PostgREST `GET` queries against `conversations` and
`scheduled_messages`, filtering channel `cf316d59-f6da-4683-adcc-29095a805dde`,
funnel `mega-sorgo`, and statuses `pending`/`paused`. Match the old two-piece
content/day and retain aggregate counts only. If rows exist, update only those
exact row IDs to `cancelled` and mark their matching old sequence terminal; do
not change sent rows, other channels, or historical conversations without
pending legacy content. Verify a second read returns zero eligible old rows.

- [ ] **Step 3: Run focused tests, type check, and repository whitespace check**

Run:
`deno test --no-check --allow-env --allow-net bridge/tests/funil-five-moments.test.ts bridge/tests/funil-anuncio.test.ts bridge/tests/funil-pausa.test.ts bridge/tests/missing-opening-recovery.test.ts bridge/tests/funil-comercial.test.ts bridge/tests/funil-offsets.test.ts`

Run: `deno check --node-modules-dir=none bridge/server.ts`

Run: `git diff --check`

Expected: all focused tests pass, the server type-checks, and the diff has no
whitespace errors.

- [ ] **Step 4: Commit, push to the production branch, and deploy**

Commit the build marker with
`git commit -m "chore: identify five-moment ad funnel build"`. Confirm the
target is the current production `main` at or ahead of `3827372`; push only the
reviewed commits, then trigger the existing Coolify deployment endpoint without
printing credentials.

- [ ] **Step 5: Verify production without sending test messages**

GET `/health` and `/version`. Expected: HTTP 200; build
`2026-10-09-funil-anuncios-5895-cinco-momentos`; feature
`funil-anuncios-5895-cinco-momentos`. Re-read the scoped queue and confirm zero
pending legacy two-piece rows. Do not replay #3500–3504 or send test messages.

## Final Self-Review

- The five active moments and content guards are covered by Task 1.
- Direct price/other intent handling, preservation of pending rows, timed
  pause/resume, and terminal exclusions are covered by Task 2.
- The stale 30% statement in the response that runs between touches is covered
  by Task 3.
- Channel-specific pending-row retirement, deployment, health, version, and
  no-replay controls are covered by Task 4.
- All tests use existing Deno conventions and keep network access only for the
  already used `deno.land/std` imports; no real WhatsApp send is part of
  validation.
