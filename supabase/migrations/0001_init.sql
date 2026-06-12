-- 0001_init.sql
-- Evo Hub <-> Chatwoot bridge + dashboard (system of record + analytics)
-- Target: Supabase self-host (bancortovital.soberano.pro)
--
-- Convenções:
--  * Edge Functions / micro-serviço escrevem com a service_role (bypassa RLS).
--  * Usuários do dashboard (role authenticated) só LEEM (SELECT) as tabelas analíticas.
--  * Segredos por canal (channel_token) vivem em channel_secrets, sem acesso a authenticated.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
do $$ begin
  create type channel_type   as enum ('whatsapp','facebook','instagram','unified');
exception when duplicate_object then null; end $$;

do $$ begin
  create type channel_status as enum ('inactive','pending','active','error','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type msg_direction  as enum ('in','out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type msg_type       as enum ('text','image','audio','video','document','sticker','location','contact','interactive','template','unknown');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conv_status    as enum ('open','pending','resolved','snoozed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conv_outcome   as enum ('open','won','lost');
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at trigger helper
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- channels: mapa EVO Hub channel  <->  Chatwoot inbox
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists channels (
  id                        uuid primary key default gen_random_uuid(),
  type                      channel_type   not null,
  name                      text           not null,
  status                    channel_status not null default 'inactive',

  -- EVO Hub
  hub_channel_id            text unique,
  external_id               text,                       -- = channels.id (devolvido nos lifecycle webhooks)

  -- Meta connection (populado no channel_connected)
  phone_number_id           text,
  waba_id                   text,
  phone_number              text,
  display_name              text,
  page_id                   text,
  ig_id                     text,

  -- Chatwoot
  chatwoot_inbox_id         bigint,
  chatwoot_inbox_identifier text,

  last_error                text,
  connected_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists idx_channels_status   on channels(status);
create index if not exists idx_channels_inbox     on channels(chatwoot_inbox_id);
create index if not exists idx_channels_phone     on channels(phone_number_id);
drop trigger if exists trg_channels_updated on channels;
create trigger trg_channels_updated before update on channels
  for each row execute function set_updated_at();

-- Segredos por canal — só service_role lê.
create table if not exists channel_secrets (
  channel_id     uuid primary key references channels(id) on delete cascade,
  channel_token  text not null,           -- Bearer das chamadas /meta/* no Hub
  webhook_secret text,                     -- HMAC compartilhado (Hub assina, nós validamos)
  updated_at     timestamptz not null default now()
);
drop trigger if exists trg_channel_secrets_updated on channel_secrets;
create trigger trg_channel_secrets_updated before update on channel_secrets
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- contacts
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists contacts (
  id                  uuid primary key default gen_random_uuid(),
  channel_id          uuid not null references channels(id) on delete cascade,
  external_contact_id text not null,                 -- número WA / PSID / IG id
  name                text,
  phone               text,
  chatwoot_contact_id bigint,
  attributes          jsonb not null default '{}'::jsonb,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (channel_id, external_contact_id)
);
create index if not exists idx_contacts_channel    on contacts(channel_id);
create index if not exists idx_contacts_cw          on contacts(chatwoot_contact_id);
drop trigger if exists trg_contacts_updated on contacts;
create trigger trg_contacts_updated before update on contacts
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- conversations  (operacional + comercial)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists conversations (
  id                      uuid primary key default gen_random_uuid(),
  channel_id              uuid not null references channels(id) on delete cascade,
  contact_id              uuid not null references contacts(id) on delete cascade,
  chatwoot_conversation_id bigint,
  status                  conv_status not null default 'open',
  assignee                text,
  opened_at               timestamptz not null default now(),
  first_response_at       timestamptz,
  resolved_at             timestamptz,
  -- comercial
  outcome                 conv_outcome not null default 'open',
  outcome_value_cents     bigint,
  outcome_source          text,
  outcome_set_at          timestamptz,
  labels                  jsonb not null default '[]'::jsonb,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (channel_id, chatwoot_conversation_id)
);
create index if not exists idx_conv_channel  on conversations(channel_id);
create index if not exists idx_conv_contact  on conversations(contact_id);
create index if not exists idx_conv_status   on conversations(status);
create index if not exists idx_conv_outcome  on conversations(outcome);
create index if not exists idx_conv_opened   on conversations(opened_at);
drop trigger if exists trg_conv_updated on conversations;
create trigger trg_conv_updated before update on conversations
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- messages
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references conversations(id) on delete cascade,
  channel_id          uuid not null references channels(id) on delete cascade,
  direction           msg_direction not null,
  msg_type            msg_type not null default 'text',
  content             text,
  media_url           text,
  meta_message_id     text,
  chatwoot_message_id bigint,
  status              text,                            -- sent/delivered/read/failed
  sent_at             timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create index if not exists idx_msg_conv     on messages(conversation_id);
create index if not exists idx_msg_channel  on messages(channel_id, sent_at);
create index if not exists idx_msg_meta_id  on messages(meta_message_id);
create unique index if not exists uq_msg_meta on messages(meta_message_id) where meta_message_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- events: auditoria bruta de tudo que entra (Hub + Chatwoot) — base analítica
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists events (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                           -- 'hub' | 'chatwoot'
  event_type  text not null,
  channel_id  uuid references channels(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  received_at timestamptz not null default now()
);
create index if not exists idx_events_channel on events(channel_id, received_at);
create index if not exists idx_events_type     on events(source, event_type, received_at);

-- dedup de entregas (substitui SETNX/Redis do guia): a constraint impede reprocesso
create table if not exists deliveries (
  delivery_id text primary key,
  source      text not null,
  received_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- proxy_usage: chamadas /meta/* (evento proxy_api_used / pull de /dashboard)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists proxy_usage (
  id          uuid primary key default gen_random_uuid(),
  channel_id  uuid references channels(id) on delete set null,
  method      text,
  endpoint    text,
  status_code int,
  response_ms int,
  cache_hit   boolean,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_proxy_channel on proxy_usage(channel_id, occurred_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- daily_metrics: rollup por dia/canal (preenchido por metrics-rollup)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists daily_metrics (
  day                   date not null,
  channel_id            uuid not null references channels(id) on delete cascade,
  msgs_in               int  not null default 0,
  msgs_out              int  not null default 0,
  new_contacts          int  not null default 0,
  conversations_opened  int  not null default 0,
  conversations_resolved int not null default 0,
  avg_first_response_s  int,
  won_count             int  not null default 0,
  lost_count            int  not null default 0,
  won_value_cents       bigint not null default 0,
  updated_at            timestamptz not null default now(),
  primary key (day, channel_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- outcome_rules: mapeia label/atributo do Chatwoot -> outcome comercial
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists outcome_rules (
  id          uuid primary key default gen_random_uuid(),
  match_label text,                                    -- ex.: 'ganho' | 'perdido'
  outcome     conv_outcome not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
insert into outcome_rules (match_label, outcome) values
  ('ganho','won'), ('won','won'), ('perdido','lost'), ('lost','lost')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: authenticated lê; service_role escreve (bypassa RLS).
-- ─────────────────────────────────────────────────────────────────────────────
alter table channels        enable row level security;
alter table channel_secrets enable row level security;   -- nenhuma policy = authenticated negado
alter table contacts        enable row level security;
alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table events          enable row level security;
alter table deliveries      enable row level security;   -- só service_role
alter table proxy_usage     enable row level security;
alter table daily_metrics   enable row level security;
alter table outcome_rules   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['channels','contacts','conversations','messages','events','proxy_usage','daily_metrics','outcome_rules']
  loop
    execute format(
      'create policy %1$s_read on %1$I for select to authenticated using (true);', t
    );
  end loop;
end $$;
