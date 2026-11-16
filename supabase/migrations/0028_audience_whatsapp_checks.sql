-- 0028: resultado da verificação de WhatsApp dos públicos, isolado por público, canal e telefone.
-- Portado do hub CECAPE. Rodar no Supabase Studio. Idempotente, schema public.
create table if not exists public.audience_whatsapp_checks (
  audience_id uuid not null references public.audiences(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  phone text not null,
  status text not null check (status in ('confirmed','not_found','unconfirmed')),
  reason text,
  checked_at timestamptz not null default now(),
  primary key (audience_id, channel_id, phone)
);
create index if not exists audience_whatsapp_checks_channel
  on public.audience_whatsapp_checks (audience_id, channel_id, status);
alter table public.audience_whatsapp_checks enable row level security;
revoke all on public.audience_whatsapp_checks from anon, authenticated;
grant select, insert, update, delete on public.audience_whatsapp_checks to service_role;
