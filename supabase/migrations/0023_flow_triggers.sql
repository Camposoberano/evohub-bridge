-- 0023: gatilho de fluxo na resposta (modelo SendPulse). Portado do hub CECAPE.
-- RODAR NO SUPABASE STUDIO SQL EDITOR (DDL manual). Idempotente. Tudo em `public`.
--
-- Campanha "modo gatilho" manda só o 1º toque (texto cold) e ARMA uma linha aqui. Quando o
-- lead responde, o bridge acha o gatilho armado e INICIA o fluxo do começo. Diferente de
-- `campaign_flow_state` (onde o contato já ESTÁ num fluxo): aqui ele ainda não entrou.

create extension if not exists pgcrypto;

create table if not exists public.flow_triggers (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null,
  channel_id uuid,
  contact_key text not null,                     -- telefone só dígitos
  status text not null default 'armed',          -- armed | done | cancelled
  armed_at timestamptz not null default pg_catalog.now(),
  fired_at timestamptz,
  unique (campaign_id, contact_key)
);

-- Busca no inbound: (canal, contato) armado.
create index if not exists flow_triggers_lookup
  on public.flow_triggers (channel_id, contact_key, status);

-- RLS: leitura dashboard_readers (pra telas), escrita só service_role (bridge). Mesmo padrão 0016/0017.
alter table public.flow_triggers enable row level security;
revoke all privileges on table public.flow_triggers from PUBLIC, anon, authenticated;
grant select on table public.flow_triggers to authenticated;
grant all privileges on table public.flow_triggers to service_role;

drop policy if exists flow_triggers_read on public.flow_triggers;
create policy flow_triggers_read on public.flow_triggers
  for select to authenticated using (public.can_read_operational_campaigns());
