-- Públicos: listas de contatos (nome + telefone) salvas e tagueadas, pra reusar no disparo.
-- Portado do hub CECAPE. Single-tenant, mesmo padrão de RLS do 0016: o painel LÊ
-- (authenticated + dashboard_readers); toda ESCRITA passa pelo bridge (service_role).
-- Rodar no Supabase Studio (SQL Editor) — DDL manual.

create table if not exists public.audiences (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  tag text,
  contact_count integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audience_contacts (
  id bigint generated always as identity primary key,
  audience_id uuid not null references public.audiences(id) on delete cascade,
  phone text not null,
  name text,
  created_at timestamptz not null default now(),
  unique (audience_id, phone)
);
create index if not exists audience_contacts_aud_idx on public.audience_contacts(audience_id);

-- RLS: leitura só pra quem está em dashboard_readers (reusa can_read_operational_campaigns do 0016).
alter table public.audiences enable row level security;
revoke all privileges on table public.audiences from PUBLIC, anon, authenticated;
grant select on table public.audiences to authenticated;
grant all privileges on table public.audiences to service_role;
drop policy if exists audiences_authorized_read on public.audiences;
create policy audiences_authorized_read on public.audiences
  for select to authenticated using (public.can_read_operational_campaigns());

alter table public.audience_contacts enable row level security;
revoke all privileges on table public.audience_contacts from PUBLIC, anon, authenticated;
grant select on table public.audience_contacts to authenticated;
grant all privileges on table public.audience_contacts to service_role;
drop policy if exists audience_contacts_authorized_read on public.audience_contacts;
create policy audience_contacts_authorized_read on public.audience_contacts
  for select to authenticated using (public.can_read_operational_campaigns());
