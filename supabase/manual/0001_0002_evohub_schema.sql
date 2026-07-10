-- 0001_0002_evohub_schema.sql
-- Manual repair for projects where public.conversations/public.messages already exist.
-- Creates the EvoHub data model in a dedicated schema to avoid collisions.

create schema if not exists evohub;
create extension if not exists pgcrypto;

grant usage on schema evohub to authenticated, service_role;

set search_path to evohub, extensions;

-- Base enums
do $$ begin
  create type channel_type as enum ('whatsapp','facebook','instagram','unified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_status as enum ('inactive','pending','active','error','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type msg_direction as enum ('in','out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type msg_type as enum ('text','image','audio','video','document','sticker','location','contact','interactive','template','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conv_status as enum ('open','pending','resolved','snoozed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conv_outcome as enum ('open','won','lost');
exception when duplicate_object then null; end $$;

-- updated_at trigger helper
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

create table if not exists channels (
  id uuid primary key default gen_random_uuid(),
  type channel_type not null,
  name text not null,
  status channel_status not null default 'inactive',
  hub_channel_id text unique,
  external_id text,
  phone_number_id text,
  waba_id text,
  phone_number text,
  display_name text,
  page_id text,
  ig_id text,
  chatwoot_inbox_id bigint,
  chatwoot_inbox_identifier text,
  last_error text,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_channels_status on channels(status);
create index if not exists idx_channels_inbox on channels(chatwoot_inbox_id);
create index if not exists idx_channels_phone on channels(phone_number_id);
drop trigger if exists trg_channels_updated on channels;
create trigger trg_channels_updated before update on channels
  for each row execute function set_updated_at();

create table if not exists channel_secrets (
  channel_id uuid primary key references channels(id) on delete cascade,
  channel_token text not null,
  webhook_secret text,
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_channel_secrets_updated on channel_secrets;
create trigger trg_channel_secrets_updated before update on channel_secrets
  for each row execute function set_updated_at();

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  external_contact_id text not null,
  name text,
  phone text,
  chatwoot_contact_id bigint,
  attributes jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, external_contact_id)
);
create index if not exists idx_contacts_channel on contacts(channel_id);
create index if not exists idx_contacts_cw on contacts(chatwoot_contact_id);
drop trigger if exists trg_contacts_updated on contacts;
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references channels(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  chatwoot_conversation_id bigint,
  status conv_status not null default 'open',
  assignee text,
  opened_at timestamptz not null default now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  outcome conv_outcome not null default 'open',
  outcome_value_cents bigint,
  outcome_source text,
  outcome_set_at timestamptz,
  labels jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, chatwoot_conversation_id)
);
create index if not exists idx_conv_channel on conversations(channel_id);
create index if not exists idx_conv_contact on conversations(contact_id);
create index if not exists idx_conv_status on conversations(status);
create index if not exists idx_conv_outcome on conversations(outcome);
create index if not exists idx_conv_opened on conversations(opened_at);
drop trigger if exists trg_conv_updated on conversations;
create trigger trg_conv_updated before update on conversations
  for each row execute function set_updated_at();

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  direction msg_direction not null,
  msg_type msg_type not null default 'text',
  content text,
  media_url text,
  meta_message_id text,
  chatwoot_message_id bigint,
  status text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists idx_msg_conv on messages(conversation_id);
create index if not exists idx_msg_channel on messages(channel_id, sent_at);
create index if not exists idx_msg_meta_id on messages(meta_message_id);
do $$
begin
  create unique index if not exists uq_msg_meta
    on messages(meta_message_id)
    where meta_message_id is not null;
exception
  when unique_violation then
    raise notice 'skipping uq_msg_meta because duplicate meta_message_id values already exist';
end $$;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text not null,
  channel_id uuid references channels(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists idx_events_channel on events(channel_id, received_at);
create index if not exists idx_events_type on events(source, event_type, received_at);

create table if not exists deliveries (
  delivery_id text primary key,
  source text not null,
  received_at timestamptz not null default now()
);

create table if not exists proxy_usage (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid references channels(id) on delete set null,
  method text,
  endpoint text,
  status_code int,
  response_ms int,
  cache_hit boolean,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_proxy_channel on proxy_usage(channel_id, occurred_at);

create table if not exists daily_metrics (
  day date not null,
  channel_id uuid not null references channels(id) on delete cascade,
  msgs_in int not null default 0,
  msgs_out int not null default 0,
  new_contacts int not null default 0,
  conversations_opened int not null default 0,
  conversations_resolved int not null default 0,
  avg_first_response_s int,
  won_count int not null default 0,
  lost_count int not null default 0,
  won_value_cents bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (day, channel_id)
);

create table if not exists outcome_rules (
  id uuid primary key default gen_random_uuid(),
  match_label text,
  outcome conv_outcome not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into outcome_rules (match_label, outcome) values
  ('ganho','won'), ('won','won'), ('perdido','lost'), ('lost','lost')
on conflict do nothing;

-- LLM orchestration enums
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
on conflict (id)
do update set
  provider = excluded.provider,
  model_name = excluded.model_name,
  specialties = excluded.specialties,
  priority = excluded.priority,
  cost_score = excluded.cost_score,
  notes = excluded.notes,
  updated_at = now();

-- RLS
alter table channels enable row level security;
alter table channel_secrets enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table events enable row level security;
alter table deliveries enable row level security;
alter table proxy_usage enable row level security;
alter table daily_metrics enable row level security;
alter table outcome_rules enable row level security;
alter table llm_models enable row level security;
alter table llm_tasks enable row level security;
alter table llm_runs enable row level security;
alter table llm_handoffs enable row level security;
alter table llm_quality_gates enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'channels',
    'contacts',
    'conversations',
    'messages',
    'events',
    'proxy_usage',
    'daily_metrics',
    'outcome_rules',
    'llm_models',
    'llm_tasks',
    'llm_runs',
    'llm_handoffs',
    'llm_quality_gates'
  ]
  loop
    execute format('drop policy if exists %I on %I;', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (true);', t || '_read', t);
  end loop;
end $$;

-- Data API grants. RLS still controls rows; channel_secrets and deliveries have no authenticated read policy.
grant select, insert, update, delete on all tables in schema evohub to service_role;
grant usage, select on all sequences in schema evohub to service_role;

grant select on table
  channels,
  contacts,
  conversations,
  messages,
  events,
  proxy_usage,
  daily_metrics,
  outcome_rules,
  llm_models,
  llm_tasks,
  llm_runs,
  llm_handoffs,
  llm_quality_gates
to authenticated;

notify pgrst, 'reload schema';
reset search_path;
