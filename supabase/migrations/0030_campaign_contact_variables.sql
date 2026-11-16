-- 0030: snapshot de variáveis por campanha e contato (personalização do disparo de fluxo).
-- Portado do hub CECAPE (0027), simplificado: campaign_id é text livre (sem FK pro campaign_ledger
-- que o EvoHub não tem). Os valores de cada contato são congelados ao lançar; o pump da fila lê de
-- volta pra interpolar {{coluna}} no fluxo. Rodar no Supabase Studio após 0021/0026.

create table if not exists public.campaign_contact_variables (
  campaign_id text not null,
  contact_key text not null,
  audience_id uuid references public.audiences(id) on delete set null,
  audience_name text not null default '',
  schema_version integer not null default 1,
  variable_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (campaign_id, contact_key)
);
create index if not exists campaign_contact_variables_audience_idx
  on public.campaign_contact_variables(audience_id, campaign_id);

alter table public.campaign_contact_variables enable row level security;
revoke all privileges on table public.campaign_contact_variables from public, anon, authenticated;
grant select on table public.campaign_contact_variables to authenticated;
grant all privileges on table public.campaign_contact_variables to service_role;
drop policy if exists campaign_contact_variables_reader on public.campaign_contact_variables;
create policy campaign_contact_variables_reader on public.campaign_contact_variables
  for select to authenticated using (public.can_read_operational_campaigns());
