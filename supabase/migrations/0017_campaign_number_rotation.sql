-- Reserva apenas uma das quatro campanhas de reativação por vez, inclusive com
-- múltiplas réplicas do bridge. Não muda a reserva das demais campanhas.
create or replace function public.claim_rotating_campaign_queue_item(p_campaign_id text)
returns table (
  id uuid,
  campaign_id text,
  contact_key text,
  channel_id uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.campaign_queue%rowtype;
begin
  if p_campaign_id not in (
    'reativacao-5895-of', 'reativacao-5895-uz',
    'reativacao-0595-uz', 'reativacao-6836-uz'
  ) then
    raise exception 'campaign is not in number rotation';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('evohub-campaign-number-rotation', 0)
  );

  if exists (
    select 1 from public.campaign_queue as active
    where active.campaign_id in (
      'reativacao-5895-of', 'reativacao-5895-uz',
      'reativacao-0595-uz', 'reativacao-6836-uz'
    ) and active.status = 'processing'
  ) then
    return;
  end if;

  update public.campaign_queue as q
  set status = 'processing', updated_at = pg_catalog.now()
  where q.id = (
    select pending.id from public.campaign_queue as pending
    where pending.campaign_id = p_campaign_id
      and pending.status = 'pending'
      and pending.attempts < 3
    order by pending.created_at
    limit 1
    for update skip locked
  )
  returning q.* into claimed;

  if not found then
    return;
  end if;

  return query select
    claimed.id, claimed.campaign_id, claimed.contact_key,
    claimed.channel_id, claimed.attempts;
end
$$;

revoke all privileges on function public.claim_rotating_campaign_queue_item(text) from PUBLIC, anon, authenticated;
grant execute on function public.claim_rotating_campaign_queue_item(text) to service_role;
