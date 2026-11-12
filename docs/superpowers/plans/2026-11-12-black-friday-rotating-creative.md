# Black Friday Mega Sorgo rotating creative Implementation Plan

> **For agentic workers:** Execute tasks in order and keep the campaign queue paused until the bridge supports the approved flow. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the approved Black Friday campaign to the 641 filtered contacts with stable rotation among three supplied images, interactive reply buttons, and the existing daily ramp.

**Architecture:** Extend the existing flow button step with a list of image URLs and select one deterministically from the normalized recipient key. Keep one campaign and one global queue so the image variants do not multiply the daily cap. Store uploaded image URLs in the existing campaign configuration; keep the queue paused until deployment and content configuration are ready.

**Tech Stack:** Deno, TypeScript, Supabase Storage/PostgREST, UAZAPI hybrid send path, existing campaign flow engine.

**Spec:** `docs/superpowers/specs/2026-11-12-black-friday-rotating-creative-design.md`

## Global Constraints

- Preserve the 13 delivered messages and do not resend them.
- The current remaining queue is 628 paused items.
- The recipient filters remain `pago`, `safrinha`, and `não compra` exclusions.
- Keep campaign pace at 50 on the first resumed day, increasing by 10 daily, 07:00–19:00 BRT.
- Do not deploy or restart the bridge between 08:00 and 20:00 BRT.
- Do not run automated tests in this session.

---

### Task 1: Add deterministic image rotation to flow button steps

**Files:**
- Modify: `bridge/shared/flow.ts`
- Modify: `bridge/shared/flow-runner.ts`
- Modify: `bridge/shared/campaign-rotation.ts`
- Modify: `bridge/server.ts` version feature markers and build label
- Modify: `bridge/shared/hybrid-menu.ts`
- Modify: `bridge/handlers/uazapi-webhook.ts` only if the exact-title normalizer needs adjustment.

**Interfaces:**
- Add optional `imageUrls?: string[]` to button flow steps; preserve existing `imageUrl?: string` compatibility.
- The runner chooses the same URL for repeated sends to the same normalized recipient and passes it to the hybrid menu and the Meta interactive fallback header.
- The Black Friday campaign uses only the UAZAPI route; it must not silently fall back to Meta.
- Add the existing campaign id to the 5895 queue rotation group so the VPS loop actually claims its queue rows.

- [ ] Add a pure selector that normalizes the recipient to digits, hashes it with a small deterministic integer hash, and selects `hash % imageUrls.length`; when the list is empty, retain `imageUrl` behavior.
- [ ] Use the selector in `enviarStep` for the `buttons` kind so both sending routes receive one selected image.
- [ ] Ensure the official interactive button request includes an image header when the selected URL is present.
- [ ] Mark flows with `uazapiOnly:true` as no-Meta-fallback and add `black-friday-mega-sorgo-5895-2026-11-12` to the 5895 campaign rotation group.
- [ ] Map the exact visible titles `Consultar desconto`, `Tenho dúvidas`, and `Deixar para depois` to their Black Friday button IDs before generic title matching.
- [ ] Review the final diff against the existing local `uazapiOnly` changes; do not overwrite them.
- [ ] Perform static inspection only; do not run tests.

### Task 2: Stage the three approved campaign images

**Files:**
- Create: `ops/black-friday-mega-sorgo-2026-11-12/artes-rotacao/` copies of the three user-supplied PNGs.
- Create: `ops/stage-black-friday-assets.mjs` for idempotent upload into new `soberano-out/funil/black-friday-2026-11-12/` paths.

**Interfaces:**
- Produce three public HTTPS URLs and verify each with HEAD before adding the URLs to campaign configuration.
- Do not overwrite a prior storage object or disclose credentials.

- [ ] Copy the three exact supplied PNG files into the campaign asset folder under stable filenames `bf-01.png`, `bf-02.png`, and `bf-03.png`.
- [ ] Upload with `upsert:false`, capture only the public URLs, and confirm each URL returns HTTP 200 with `image/png` content type.
- [ ] Record the three resulting URLs in the campaign flow configuration.

### Task 3: Configure the approved flow while keeping its queue paused

**Files:**
- Modify live `soberano-config/campaigns.json` entry `black-friday-mega-sorgo-5895-2026-11-12` only after the image URLs exist.
- Update: `HANDOFF.md` with the queue and deployment state.

**Interfaces:**
- The flow starts with one `buttons` step containing the approved caption, three button IDs/titles, and `imageUrls`.
- The `Consultar desconto` and `Tenho dúvidas` branches send their distinct prompts and set `pedirHumano:true`; `Deixar para depois` terminates.

- [ ] Replace only the campaign flow entry with the approved image/button flow.
- [ ] Set `paceStartAt` to `2026-11-13T10:00:00Z` so the first resumed day begins at 07:00 BRT with a cap of 50.
- [ ] Leave all 628 queue records paused and verify the 13 sent records remain unchanged.
- [ ] Review campaign JSON for exact image URLs, captions, button IDs, branches, and pace before deployment.

### Task 4: Publish and resume safely

**Files:**
- Publish only the targeted code change from `main`, following `AGENTS.md`.

**Interfaces:**
- Confirm the running bridge has the image-rotation feature before changing any `paused` queue item to `pending`.
- Reopen only the 628 unsent rows for this campaign.

- [ ] Cherry-pick the focused code change onto `main` and publish using the configured POST deployment endpoint after 20:00 BRT.
- [ ] Confirm `version.features` or uptime rather than the manual build label.
- [ ] Change only the 628 paused rows for this campaign to `pending` after deployment confirmation.
- [ ] Set the queue to begin at 07:00 BRT on 13/11/2026 and confirm the 50/day ramp before the first send.

## Verification limits

Automated tests are intentionally not run in this session. Verify code paths by reviewing the diff, validate uploaded objects by HEAD, validate campaign JSON before unpausing, and inspect the first receipt before allowing subsequent queue ticks.
