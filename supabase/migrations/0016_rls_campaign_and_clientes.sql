-- Restringe os dados operacionais usados pelo painel e mantém `clientes` privado.
-- A aplicação é single-tenant: usuários autenticados do painel podem ler o estado
-- da fila; toda escrita e os dados da lista fria passam pelo bridge com service_role.

do $$
declare
  schema_name text;
  policy_name text;
begin
  foreach schema_name in array array['public', 'evohub'] loop
    if to_regclass(format('%I.%I', schema_name, 'campaign_queue')) is not null then
      execute format('alter table %I.%I enable row level security', schema_name, 'campaign_queue');
      execute format('revoke all privileges on table %I.%I from PUBLIC, anon, authenticated', schema_name, 'campaign_queue');
      execute format('grant select on table %I.%I to authenticated', schema_name, 'campaign_queue');
      execute format('grant all privileges on table %I.%I to service_role', schema_name, 'campaign_queue');
      for policy_name in
        select policyname from pg_policies
        where schemaname = schema_name and tablename = 'campaign_queue'
      loop
        execute format('drop policy %I on %I.%I', policy_name, schema_name, 'campaign_queue');
      end loop;
      execute format(
        'create policy campaign_queue_authenticated_read on %I.%I for select to authenticated using (true)',
        schema_name,
        'campaign_queue'
      );
    end if;

    if to_regclass(format('%I.%I', schema_name, 'campaign_flow_state')) is not null then
      execute format('alter table %I.%I enable row level security', schema_name, 'campaign_flow_state');
      execute format('revoke all privileges on table %I.%I from PUBLIC, anon, authenticated', schema_name, 'campaign_flow_state');
      execute format('grant select on table %I.%I to authenticated', schema_name, 'campaign_flow_state');
      execute format('grant all privileges on table %I.%I to service_role', schema_name, 'campaign_flow_state');
      for policy_name in
        select policyname from pg_policies
        where schemaname = schema_name and tablename = 'campaign_flow_state'
      loop
        execute format('drop policy %I on %I.%I', policy_name, schema_name, 'campaign_flow_state');
      end loop;
      execute format(
        'create policy campaign_flow_state_authenticated_read on %I.%I for select to authenticated using (true)',
        schema_name,
        'campaign_flow_state'
      );
    end if;

    if to_regclass(format('%I.%I', schema_name, 'clientes')) is not null then
      execute format('alter table %I.%I enable row level security', schema_name, 'clientes');
      execute format('revoke all privileges on table %I.%I from PUBLIC, anon, authenticated', schema_name, 'clientes');
      execute format('grant all privileges on table %I.%I to service_role', schema_name, 'clientes');
      for policy_name in
        select policyname from pg_policies
        where schemaname = schema_name and tablename = 'clientes'
      loop
        execute format('drop policy %I on %I.%I', policy_name, schema_name, 'clientes');
      end loop;
    end if;
  end loop;
end
$$;

comment on column public.campaign_queue.status is 'pending → processing → sent | failed | skipped; pending → paused → pending. `skipped` é contato excluído em tempo de envio; `failed` também registra resultado de envio incerto e exige revisão.';

-- Registra a incerteza e pausa os demais destinatários na mesma transação.
create or replace function public.pause_campaign_after_uncertain_send(
  p_item_id uuid,
  p_reason text,
  p_before timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_campaign_id text;
  current_status text;
  item_updated_at timestamptz;
begin
  select campaign_id into target_campaign_id
  from public.campaign_queue
  where id = p_item_id;
  if not found then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(target_campaign_id, 0)
  );

  select campaign_id, status, updated_at
    into target_campaign_id, current_status, item_updated_at
  from public.campaign_queue
  where id = p_item_id
  for update;
  if not found then
    return false;
  end if;

  if current_status = 'processing'
    and (p_before is null or item_updated_at < p_before) then
    update public.campaign_queue
    set status = 'failed',
        last_error = left('resultado de envio incerto: ' || coalesce(p_reason, 'sem detalhe'), 300),
        updated_at = pg_catalog.now()
    where id = p_item_id and status = 'processing';
  elsif current_status = 'sent' and p_before is null then
    update public.campaign_queue
    set last_error = left('confirme o registro do envio: ' || coalesce(p_reason, 'sem detalhe'), 300),
        updated_at = pg_catalog.now()
    where id = p_item_id and status = 'sent';
  else
    return false;
  end if;

  update public.campaign_queue
  set status = 'paused',
      last_error = left('campanha pausada para revisar envio incerto: ' || coalesce(p_reason, 'sem detalhe'), 300),
      updated_at = pg_catalog.now()
  where campaign_id = target_campaign_id and status = 'pending';

  return true;
end
$$;

revoke all privileges on function public.pause_campaign_after_uncertain_send(uuid, text, timestamptz) from PUBLIC, anon, authenticated;
grant execute on function public.pause_campaign_after_uncertain_send(uuid, text, timestamptz) to service_role;

-- Reserva serializada por campanha, inclusive se houver mais de uma réplica do bridge.
create or replace function public.claim_campaign_queue_item(p_campaign_id text)
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_campaign_id, 0)
  );

  if exists (
    select 1 from public.campaign_queue as active
    where active.campaign_id = p_campaign_id and active.status = 'processing'
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
    claimed.id,
    claimed.campaign_id,
    claimed.contact_key,
    claimed.channel_id,
    claimed.attempts;
end
$$;

revoke all privileges on function public.claim_campaign_queue_item(text) from PUBLIC, anon, authenticated;
grant execute on function public.claim_campaign_queue_item(text) to service_role;
