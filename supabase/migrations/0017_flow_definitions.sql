-- 0017: fluxos como entidade de 1ª classe + versões imutáveis (Editor de Fluxos).
-- Portado do hub CECAPE. RODAR NO SUPABASE STUDIO SQL EDITOR (DDL manual — nunca expor 5432).
-- Idempotente. Tudo em `public` (mesmo schema das tabelas existentes do EvoHub).
-- RLS reusa can_read_operational_campaigns() + app_private.dashboard_readers do 0016.

create extension if not exists pgcrypto;

-- Biblioteca de fluxos (rascunho editável). graph_json = { steps, startId } do shared/flow.ts.
create table if not exists public.flow_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status text not null default 'draft',          -- draft | published | archived
  graph_json jsonb not null default '{"steps":[]}'::jsonb,
  current_version integer,                        -- aponta pra flow_versions.version publicada
  created_by uuid references auth.users(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

-- Snapshots IMUTÁVEIS. Publicar grava uma linha nova; execução em andamento usa a versão fixada.
create table if not exists public.flow_versions (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.flow_definitions(id) on delete cascade,
  version integer not null,
  graph_json jsonb not null,
  checksum text not null,
  published_by uuid references auth.users(id),
  published_at timestamptz not null default pg_catalog.now(),
  unique (flow_id, version)
);

create index if not exists flow_versions_flow_idx on public.flow_versions (flow_id, version desc);

-- RLS: leitura só pra quem está no app_private.dashboard_readers (mesma função do 0016);
-- escrita só pelo bridge (service_role). O painel lê direto; grava via endpoint /flows do bridge.
alter table public.flow_definitions enable row level security;
alter table public.flow_versions enable row level security;

revoke all privileges on table public.flow_definitions from PUBLIC, anon, authenticated;
revoke all privileges on table public.flow_versions from PUBLIC, anon, authenticated;
grant select on table public.flow_definitions to authenticated;
grant select on table public.flow_versions to authenticated;
grant all privileges on table public.flow_definitions to service_role;
grant all privileges on table public.flow_versions to service_role;

drop policy if exists flow_definitions_read on public.flow_definitions;
create policy flow_definitions_read on public.flow_definitions
  for select to authenticated using (public.can_read_operational_campaigns());

drop policy if exists flow_versions_read on public.flow_versions;
create policy flow_versions_read on public.flow_versions
  for select to authenticated using (public.can_read_operational_campaigns());
