# Campo Soberano Flow Library and Visual Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work inline; no subagents are requested for this project.

**Goal:** Add a versioned flow library, visual editor, and local simulator to the Campo Soberano panel while preserving its existing campaign execution and separate database.

**Architecture:** Start from the deployed Campo code line in an isolated worktree. Add two `public` tables and one transactional publish RPC to the Campo database; expose them through an authenticated Bridge route. The Next.js `/fluxos` page edits the existing six-kind `Flow` model and talks only to that route. A build-time flag keeps the current JSON interface active until validation.

**Tech Stack:** Deno/TypeScript Bridge, Supabase/PostgreSQL with RLS, Next.js 14/React 18, `@xyflow/react` 12, PowerShell on Windows.

**Spec:** `docs/superpowers/specs/2026-10-18-campo-biblioteca-editor-fluxos-design.md` (commit `9b7500e`). Source behavior: Faculdade CECAPE commits `0452d9e`, `f070b61`, `e30b3b7`, `937979c` in `E:/Projetos_Novos/faculdade-cecape`.

## Global Constraints

- Preserve the dirty primary checkout of `E:/Projetos_Novos/evohub`; execute in an isolated worktree.
- Confirm the deployed code line before choosing a base. On 19/10, `origin/main` was `ef07259`, while local `master` was 108 commits behind it.
- Keep Campo's Supabase, Chatwoot, channels, credentials, branding, contacts, and campaigns separate from Faculdade CECAPE and CECAPE Dental.
- Expose only `text`, `media`, `buttons`, `list`, `wait`, and `end` in this release. Publishing a library flow never starts or changes a campaign.
- Use `public` explicitly for new tables and RPC; the Campo template says `SUPABASE_SCHEMA=evohub`, but migrations `0014` and `0016` use `public`.
- Require a user JWT and `public.can_read_operational_campaigns()` under that JWT for every `/flows` request. Acquire service role only afterward.
- Default `NEXT_PUBLIC_FLOW_EDITOR_V2` to `0`, including the build argument in `web/Dockerfile`.
- Do not send live messages, apply production SQL, or deploy production services during code implementation.

## File map

- `supabase/migrations/0017_flow_library.sql`: tables, RLS, immutable-version guard, atomic publish function.
- `supabase/manual/verify_flow_library.sql`: read-only schema checks and a rollback-only smoke transaction.
- `bridge/handlers/flows.ts`: authentication, CRUD, snapshot reads, stable checksum, HTTP errors.
- `bridge/server.ts`: `/flows` route inside the existing CORS dispatcher.
- `bridge/tests/flows-library.test.ts`: authorization, snapshot, and stale-publish tests.
- `web/components/FlowCanvas.jsx`: controlled six-kind visual editor.
- `web/components/FlowSimulator.jsx`: local graph traversal without network calls.
- `web/app/fluxos/page.jsx`: library/editor integration preserving legacy JSON and send controls.
- `web/Dockerfile`, `web/package.json`, `web/package-lock.json`: build flag and React Flow dependency.

## Task 1: Establish the isolated baseline

**Files:** No application changes. Carry the approved spec into the worktree.

**Interfaces:** Produces a clean Campo branch/worktree and records the deployed SHA for all later tasks.

- [ ] **Step 1: Read deployment and refs without changing services.**

```powershell
Invoke-RestMethod 'https://cofre.camposoberano.com.br/version' | ConvertTo-Json -Depth 8
git -C 'E:/Projetos_Novos/evohub' fetch origin main master
git -C 'E:/Projetos_Novos/evohub' rev-parse origin/main origin/master
git -C 'E:/Projetos_Novos/evohub' status --short --branch
```

Record the Bridge SHA from `/version` if exposed and the PAINEL SHA from its Coolify deployment record. If unavailable, use the configured deploy branch `main` (`CLAUDE.md`) and record that assumption. Never use the dirty local `master` as an implicit base.

- [ ] **Step 2: Invoke `using-git-worktrees`, check for existing isolation and native tools, then create the target-repo worktree.** With `origin/main` verified as the base and `.worktrees/` confirmed ignored:

```powershell
git -C 'E:/Projetos_Novos/evohub' check-ignore .worktrees
git -C 'E:/Projetos_Novos/evohub' worktree add 'E:/Projetos_Novos/evohub/.worktrees/campo-flow-library-editor' -b codex/campo-flow-library-editor origin/main
git -C 'E:/Projetos_Novos/evohub/.worktrees/campo-flow-library-editor' cherry-pick 9b7500e
```

Use native worktree tooling if it can target this separate repository. Substitute the verified base if it differs; record the chosen ref. The cherry-pick carries only the approved spec.

- [ ] **Step 3: Run the focused baseline.**

```powershell
git status --short --branch
deno test --allow-all bridge/tests/flow.test.ts bridge/tests/flow-runner.test.ts
```

Run from the isolated worktree. Record any pre-existing failure before editing.

## Task 2: Create the versioned library schema

**Files:** Create `supabase/migrations/0017_flow_library.sql` and `supabase/manual/verify_flow_library.sql`.

**Interfaces:** Produces `public.flow_definitions`, `public.flow_versions`, and `public.publish_flow_version(p_flow_id uuid, p_expected_updated_at timestamptz, p_graph jsonb, p_checksum text, p_user_id uuid) returns integer` for Task 3.

- [ ] **Step 1: Add the two tables with explicit schema, RLS, and privileges.** Keep `0016_rls_campaign_and_clientes.sql` untouched.

```sql
create extension if not exists pgcrypto;
create table if not exists public.flow_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  description text,
  status text not null default 'draft' check (status in ('draft','published','archived')),
  graph_json jsonb not null default '{"steps":[]}'::jsonb,
  current_version integer,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flow_definitions(id),
  version integer not null check (version > 0),
  graph_json jsonb not null,
  checksum text not null,
  published_by uuid references auth.users(id),
  published_at timestamptz not null default now(),
  unique (flow_id, version)
);
create index if not exists flow_versions_flow_version_idx
  on public.flow_versions (flow_id, version desc);
alter table public.flow_definitions enable row level security;
alter table public.flow_versions enable row level security;
revoke all on public.flow_definitions, public.flow_versions from PUBLIC, anon, authenticated;
grant all on public.flow_definitions, public.flow_versions to service_role;
```

- [ ] **Step 2: Make snapshots immutable and publication atomic.** Add this SQL to the same migration after the table grants:

```sql
create or replace function public.reject_flow_version_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'immutable_flow_version' using errcode = '55000';
end;
$$;
revoke all on function public.reject_flow_version_change()
  from PUBLIC, anon, authenticated;
drop trigger if exists flow_versions_immutable on public.flow_versions;
create trigger flow_versions_immutable before update or delete
on public.flow_versions for each row execute function public.reject_flow_version_change();

create or replace function public.publish_flow_version(
  p_flow_id uuid, p_expected_updated_at timestamptz, p_graph jsonb,
  p_checksum text, p_user_id uuid
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_definition public.flow_definitions%rowtype;
  v_version integer;
begin
  select * into v_definition from public.flow_definitions
    where id = p_flow_id for update;
  if not found then raise exception 'flow_missing' using errcode = 'P0002'; end if;
  if v_definition.status = 'archived' then
    raise exception 'flow_archived' using errcode = '22023';
  end if;
  if v_definition.updated_at is distinct from p_expected_updated_at
     or v_definition.graph_json is distinct from p_graph then
    raise exception 'stale_draft' using errcode = '40001';
  end if;
  v_version := coalesce(v_definition.current_version, 0) + 1;
  insert into public.flow_versions(flow_id, version, graph_json, checksum, published_by)
  values (p_flow_id, v_version, p_graph, p_checksum, p_user_id);
  update public.flow_definitions
    set current_version = v_version, status = 'published', updated_at = now()
    where id = p_flow_id;
  return v_version;
end;
$$;
revoke all on function public.publish_flow_version(uuid,timestamptz,jsonb,text,uuid)
  from PUBLIC, anon, authenticated;
grant execute on function public.publish_flow_version(uuid,timestamptz,jsonb,text,uuid)
  to service_role;
```

The function locks one draft, inserts the immutable snapshot, and advances the pointer within one transaction. Re-running the migration replaces the function and trigger without editing snapshots.

- [ ] **Step 3: Add a rollback-only smoke script for a Campo validation database.**

```sql
select to_regclass('public.flow_definitions') as definitions,
       to_regclass('public.flow_versions') as versions;
select proname, prosecdef from pg_proc
where oid = 'public.publish_flow_version(uuid,timestamptz,jsonb,text,uuid)'::regprocedure;
begin;
insert into public.flow_definitions (name, graph_json)
values ('flow-library-smoke', '{"steps":[{"id":"start","kind":"text","text":"Teste"}]}'::jsonb);
rollback;
```

Expected: schema objects exist and the smoke row does not persist. No external database is changed while writing these files.

- [ ] **Step 4: Review and commit only these files.**

```powershell
git diff --check
git add supabase/migrations/0017_flow_library.sql supabase/manual/verify_flow_library.sql
git commit -m 'feat(flows): add isolated versioned flow library schema'
```

## Task 3: Expose the authenticated Bridge library

**Files:** Create `bridge/handlers/flows.ts` and `bridge/tests/flows-library.test.ts`; modify `bridge/server.ts`.

**Interfaces:** `createFlowsHandler(deps: FlowsDeps): (req: Request) => Promise<Response>` for tests; `handle` for the server. `FlowsDeps.authorize` returns `{ userId: string } | Response`; `FlowsDeps.db` returns the existing `DbClient`. All reads use `publicTable`; publication uses Task 2's `publicRpc`.

- [ ] **Step 1: Write behavior tests before the handler.** Check authorization before DB use, stable serialization, and SQL error mapping. Snapshot immutability is exercised against the validation database in Task 5. Start with:

```ts
import { canonicalJson, createFlowsHandler, statusForFlowDbError } from '../handlers/flows.ts';

Deno.test('flows rejects a non-reader before database access', async () => {
  let dbCalled = false;
  const handle = createFlowsHandler({
    authorize: async () => new Response('{"error":"forbidden"}', { status: 403 }),
    db: () => { dbCalled = true; throw new Error('unexpected DB use'); },
  });
  const res = await handle(new Request('http://local/flows'));
  if (res.status !== 403 || dbCalled) throw new Error('authorization did not gate DB access');
});

Deno.test('canonical graph JSON ignores object insertion order', () => {
  const a = { steps: [{ id: 'x', kind: 'text', text: 'Oi' }], startId: 'x' };
  const b = { startId: 'x', steps: [{ text: 'Oi', kind: 'text', id: 'x' }] };
  if (canonicalJson(a) !== canonicalJson(b)) throw new Error('unstable graph JSON');
});

Deno.test('stale publish becomes conflict', () => {
  if (statusForFlowDbError({ code: '40001' }) !== 409)
    throw new Error('stale draft must return 409');
});
```

Run `deno test --allow-all bridge/tests/flows-library.test.ts`; initial failure is expected because the handler is absent.

- [ ] **Step 2: Implement JWT plus the existing reader permission.** Return 401 without a valid JWT and 403 when `can_read_operational_campaigns()` is not true. Only then call `admin()`.

```ts
export type FlowsDeps = {
  authorize: (req: Request) => Promise<{ userId: string } | Response>;
  db: () => DbClient;
};
export function createFlowsHandler(deps: FlowsDeps) {
  return async (req: Request): Promise<Response> => {
    const authorized = await deps.authorize(req);
    if (authorized instanceof Response) return authorized;
    const db = deps.db();
    return await dispatchFlowRequest(req, db, authorized.userId);
  };
}
export const handle = createFlowsHandler({
  authorize: authorizeDashboardReader,
  db: admin,
});

async function authorizeDashboardReader(req: Request): Promise<{ userId: string } | Response> {
  const uc = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data: authData } = await uc.auth.getUser();
  if (!authData.user) return json({ error: 'unauthorized' }, 401);
  const { data: canRead, error: permissionError } =
    await uc.rpc('can_read_operational_campaigns');
  if (permissionError || canRead !== true)
    return json({ error: 'forbidden' }, 403);
  return { userId: authData.user.id };
}
```

- [ ] **Step 3: Implement `dispatchFlowRequest(req, db, userId)` against `public` only.** `GET /flows` excludes archived unless `include_archived=1`; `GET ?id=` returns the editable graph and version metadata; `GET ?id=&version=N` reads `flow_versions`. `POST save` updates the draft/name/description/updated_at and refuses archived flows. `POST publish` validates with the existing `validateFlow`, computes SHA-256 from recursively key-sorted JSON, then calls the transactional RPC. `archive` sets archived; `unarchive` returns to published when a current version exists, otherwise draft. Map SQLSTATE `40001` to HTTP 409, `P0002` to 404, and `22023` to 409. Core publish call:

```ts
const graph = definition.graph_json as Flow;
const problems = validateFlow(graph);
if (problems.length) return json({ error: 'invalid_flow', problems }, 400);
const canonical = canonicalJson(graph); // recursively sort object keys, preserve array order
const bytes = new TextEncoder().encode(canonical);
const digest = await crypto.subtle.digest('SHA-256', bytes);
const checksum = [...new Uint8Array(digest)]
  .map((n) => n.toString(16).padStart(2, '0')).join('');
const { data, error } = await publicRpc(db, 'publish_flow_version', {
  p_flow_id: definition.id,
  p_expected_updated_at: definition.updated_at,
  p_graph: graph,
  p_checksum: checksum,
  p_user_id: userId,
});
```

Export `canonicalJson` and `statusForFlowDbError` for these tests. `canonicalJson` is a local pure function: arrays map recursively in order; objects sort `Object.keys(value)` and serialize each `[key, value]`; primitives use `JSON.stringify`. Implement the error mapper as:

```ts
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export function statusForFlowDbError(error: { code?: string }): number {
  if (error.code === 'P0002') return 404;
  if (error.code === '40001' || error.code === '22023') return 409;
  return 500;
}
```

- [ ] **Step 4: Register the route inside `routes` so the dispatcher supplies CORS.**

```ts
import { handle as flows } from './handlers/flows.ts';
// within the existing routes map:
'/flows': flows,
```

- [ ] **Step 5: Run focused checks and commit.**

```powershell
deno test --allow-all bridge/tests/flows-library.test.ts bridge/tests/flow.test.ts
deno check bridge/server.ts
git diff --check
git add bridge/handlers/flows.ts bridge/server.ts bridge/tests/flows-library.test.ts
git commit -m 'feat(flows): expose authorized versioned library through Bridge'
```

## Task 4: Add the flagged editor and simulator

**Files:** Create `web/components/FlowCanvas.jsx` and `web/components/FlowSimulator.jsx`; modify `web/app/fluxos/page.jsx`, `web/Dockerfile`, `web/package.json`, `web/package-lock.json`.

**Interfaces:** `FlowCanvas({ value, onChange })` emits the existing `Flow` JSON shape. `FlowSimulator({ value, vars })` makes no network calls. The page calls Task 3's `/flows` with a bearer token. With the build flag off, the current JSON/send path remains available.

- [ ] **Step 1: Install matching React Flow dependency.**

```powershell
npm --prefix web install '@xyflow/react@^12.3.5'
```

Expected: only `web/package.json` and `web/package-lock.json` change. Use Faculdade commit `0452d9e:web/components/FlowCanvas.jsx` and `f070b61:web/components/FlowSimulator.jsx` as behavioral references. Do not copy Faculdade branding, endpoints, test contacts, or advanced node kinds.

- [ ] **Step 2: Create the controlled canvas and local simulator.** Node positions may use browser localStorage; graph data remains `Flow`. Explicitly restrict the palette:

```js
const KINDS = ['text', 'media', 'buttons', 'list', 'wait', 'end'];
function applyChange(nextSteps, startId) {
  onChange({ steps: nextSteps, ...(startId ? { startId } : {}) });
}
function nextId(step, reply, timedOut = false) {
  if (timedOut) return step.onTimeout ?? null;
  if (reply && step.branches?.[reply]) return step.branches[reply];
  if (step.kind === 'buttons' || step.kind === 'list')
    return step.fallbackNext ?? step.next ?? null;
  return step.next ?? null;
}
```

The simulator advances over `next`, `branches`, `fallbackNext`, and `wait` with a virtual clock. It must not import `BRIDGE_URL`, `supabase`, or provider send functions. A local sample graph contains a button branch and a timeout so both routes can be inspected without a message send.

- [ ] **Step 3: Integrate library calls and lazy-loaded components into `/fluxos`.** Keep existing JSON and send controls as the flag-off branch. Add save/reopen/publish/archive controls that call the Bridge only:

```js
async function flowRequest(payload, query = '') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');
  const response = await fetch(`${BRIDGE_URL}/flows${query}`, {
    method: payload ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
```

Use `next/dynamic` with `ssr:false` for both components. Editing a published flow changes its editable draft, not the published snapshot. On request failure, show the error while preserving the current editor value. Never read `flow_definitions`/`flow_versions` directly from the browser.

- [ ] **Step 4: Add the default-off build arg, build, and scan imports.**

```dockerfile
ARG NEXT_PUBLIC_FLOW_EDITOR_V2=0
ENV NEXT_PUBLIC_FLOW_EDITOR_V2=$NEXT_PUBLIC_FLOW_EDITOR_V2
```

```powershell
npm --prefix web run build
rg -n 'cecape\.cloud|cecape-logo|funil-enem|funil-matricula|flow_definitions' web/app/fluxos/page.jsx web/components/FlowCanvas.jsx web/components/FlowSimulator.jsx
```

Expected: build passes, and any match for `flow_definitions` is only a comment about avoiding direct access. No Faculdade content appears.

- [ ] **Step 5: Commit the web slice only.**

```powershell
git diff --check
git add web/components/FlowCanvas.jsx web/components/FlowSimulator.jsx web/app/fluxos/page.jsx web/Dockerfile web/package.json web/package-lock.json
git commit -m 'feat(painel): add flagged visual flow library editor'
```

## Task 5: Integrated validation and release package

**Files:** Create `docs/superpowers/plans/2026-10-19-campo-fluxos-validation.md`; modify the approved spec only if implementation decisions changed.

**Interfaces:** Produces a reviewed branch and exact migration/rollback record; it does not change production.

- [ ] **Step 1: Run the relevant gates from the isolated worktree.**

```powershell
deno test --allow-all bridge/tests/flow.test.ts bridge/tests/flow-runner.test.ts bridge/tests/flows-library.test.ts
deno check bridge/server.ts
npm --prefix web run build
git diff --check
```

Expected: zero exit codes. Report a pre-existing baseline failure separately if Task 1 found one.

- [ ] **Step 2: Validate in the Campo validation database only.** Confirm the exact Supabase project/ref and schema. Run `0017_flow_library.sql`, then `verify_flow_library.sql`. With test JWTs, exercise: 401 without token; 403 for non-reader; save/reopen/publish; unchanged `v1` after editing draft; incremented `v2`; archive/unarchive; 409 for stale publish. Exercise the panel with flag off/on and the simulator only. No test invokes the existing send button against a real number.

- [ ] **Step 3: Write the release record using actual results.** Include the verified deployed SHAs, target database identity, command outputs, exact file/commit list, and order: Campo migration → SERVIDOR (Bridge) deploy → PAINEL deploy with editor off → API/simulator validation → flag on in validation → separate production review. Rollback: flag off and revert code deployments; leave additive tables for investigation. Name SERVIDOR and PAINEL separately, per `CLAUDE.md`.

- [ ] **Step 4: Review branch diff and commit the validation record.**

```powershell
git diff --check origin/main...HEAD
git diff --stat origin/main...HEAD
git status --short --branch
git add -f docs/superpowers/plans/2026-10-19-campo-fluxos-validation.md
git commit -m 'docs: record Campo flow library validation and rollout'
```

Report the branch/worktree path, commits, test output, and production prerequisites. Do not push or deploy unless that exact external action is authorized.
