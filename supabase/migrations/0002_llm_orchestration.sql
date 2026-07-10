-- 0002_llm_orchestration.sql
-- Orquestracao de modelos e auditoria de execucoes no schema public.

do $$ begin
  create type llm_task_area as enum ('architecture','backend','frontend_visual','debug','tests','ops','analysis');
exception when duplicate_object then null; end $$;

do $$ begin
  create type llm_task_status as enum ('queued','running','review','completed','failed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type llm_run_role as enum ('primary','reviewer','fallback','arbiter');
exception when duplicate_object then null; end $$;

do $$ begin
  create type llm_run_status as enum ('started','succeeded','failed','timeout','skipped');
exception when duplicate_object then null; end $$;

create table if not exists llm_models (
  id text primary key,
  provider text not null,
  model_name text not null,
  specialties llm_task_area[] not null default '{}'::llm_task_area[],
  is_active boolean not null default true,
  priority int not null default 100,
  cost_score numeric(4,3) not null default 0.500,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_llm_models_active on llm_models(is_active, priority);
drop trigger if exists trg_llm_models_updated on llm_models;
create trigger trg_llm_models_updated before update on llm_models
  for each row execute function set_updated_at();

create table if not exists llm_tasks (
  id uuid primary key default gen_random_uuid(),
  external_ref text,
  area llm_task_area not null,
  risk_level text not null check (risk_level in ('low','medium','high')),
  title text not null,
  objective text not null,
  payload jsonb not null default '{}'::jsonb,
  status llm_task_status not null default 'queued',
  strict_review boolean not null default false,
  selected_primary text references llm_models(id),
  selected_reviewer text references llm_models(id),
  attempts int not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_llm_tasks_status on llm_tasks(status, created_at);
create index if not exists idx_llm_tasks_area on llm_tasks(area, status);
drop trigger if exists trg_llm_tasks_updated on llm_tasks;
create trigger trg_llm_tasks_updated before update on llm_tasks
  for each row execute function set_updated_at();

create table if not exists llm_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references llm_tasks(id) on delete cascade,
  model_id text not null references llm_models(id),
  role llm_run_role not null,
  attempt_no int not null default 1,
  status llm_run_status not null default 'started',
  score numeric(5,3),
  route_reason jsonb not null default '[]'::jsonb,
  input_summary text,
  output_summary text,
  output_payload jsonb not null default '{}'::jsonb,
  prompt_tokens int,
  completion_tokens int,
  total_tokens int,
  cached_tokens int,
  cache_write_tokens int,
  cache_hit boolean,
  prompt_cache_key text,
  prompt_cache_ttl text,
  prompt_cache_mode text,
  latency_ms int,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_llm_runs_task on llm_runs(task_id, started_at);
create index if not exists idx_llm_runs_model on llm_runs(model_id, started_at);
create index if not exists idx_llm_runs_status on llm_runs(status, started_at);

create table if not exists llm_handoffs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references llm_tasks(id) on delete cascade,
  from_run_id uuid references llm_runs(id) on delete set null,
  to_model_id text references llm_models(id),
  payload jsonb not null,
  checksum text,
  created_at timestamptz not null default now()
);
create index if not exists idx_llm_handoffs_task on llm_handoffs(task_id, created_at);

create table if not exists llm_quality_gates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references llm_tasks(id) on delete cascade,
  run_id uuid references llm_runs(id) on delete set null,
  lint_status text not null default 'na' check (lint_status in ('pass','fail','na')),
  build_status text not null default 'na' check (build_status in ('pass','fail','na')),
  tests_status text not null default 'na' check (tests_status in ('pass','fail','na')),
  security_status text not null default 'na' check (security_status in ('pass','fail','na')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_llm_gates_task on llm_quality_gates(task_id, created_at);

insert into llm_models (id, provider, model_name, specialties, priority, cost_score, notes)
values
  ('cloud_arch', 'cloud', 'cloud-architecture', '{architecture,analysis,ops}'::llm_task_area[], 10, 0.450, 'foco em arquitetura e arbitragem'),
  ('codex_exec', 'openai', 'gpt-5.3-codex', '{backend,debug,tests,analysis}'::llm_task_area[], 20, 0.650, 'foco em implementacao tecnica'),
  ('gemini_visual', 'google', 'gemini-visual', '{frontend_visual,analysis}'::llm_task_area[], 30, 0.550, 'foco em UX/UI e revisao visual')
on conflict (id) do update set
  provider = excluded.provider,
  model_name = excluded.model_name,
  specialties = excluded.specialties,
  priority = excluded.priority,
  cost_score = excluded.cost_score,
  notes = excluded.notes,
  updated_at = now();

alter table llm_models enable row level security;
alter table llm_tasks enable row level security;
alter table llm_runs enable row level security;
alter table llm_handoffs enable row level security;
alter table llm_quality_gates enable row level security;

drop policy if exists llm_models_read on llm_models;
create policy llm_models_read on llm_models for select to authenticated using (true);
drop policy if exists llm_tasks_read on llm_tasks;
create policy llm_tasks_read on llm_tasks for select to authenticated using (true);
drop policy if exists llm_runs_read on llm_runs;
create policy llm_runs_read on llm_runs for select to authenticated using (true);
drop policy if exists llm_handoffs_read on llm_handoffs;
create policy llm_handoffs_read on llm_handoffs for select to authenticated using (true);
drop policy if exists llm_quality_gates_read on llm_quality_gates;
create policy llm_quality_gates_read on llm_quality_gates for select to authenticated using (true);
