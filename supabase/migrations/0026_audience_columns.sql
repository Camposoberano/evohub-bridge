-- 0026: Públicos como tabelas nomeadas — esquema estável de colunas + edição auditável.
-- Portado do hub CECAPE. Rodar no Supabase Studio após 0021/0022. Idempotente, schema public.
-- Prévia somente leitura antes de aplicar:
-- select count(*) as tabelas, sum(cardinality(columns)) as colunas from public.audiences;

alter table public.audiences
  add column if not exists column_schema jsonb not null default '[]'::jsonb;
alter table public.audiences
  add column if not exists schema_version integer not null default 1;

create table if not exists public.audience_edit_log (
  id bigint generated always as identity primary key,
  audience_id uuid not null references public.audiences(id) on delete cascade,
  contact_phone text not null,
  field_key text not null,
  old_value text,
  new_value text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists audience_edit_log_audience_idx
  on public.audience_edit_log(audience_id, changed_at desc);

alter table public.audience_edit_log enable row level security;
revoke all privileges on table public.audience_edit_log from public, anon, authenticated;
grant select on table public.audience_edit_log to authenticated;
grant all privileges on table public.audience_edit_log to service_role;
drop policy if exists audience_edit_log_authorized_read on public.audience_edit_log;
create policy audience_edit_log_authorized_read on public.audience_edit_log
  for select to authenticated using (public.can_read_operational_campaigns());

-- Migra títulos existentes sem perder grafia nem ordem. Valores legados ficam sob a chave antiga
-- e são copiados para a nova chave estável quando livre.
do $migration$
declare
  a record;
  title text;
  base_key text;
  candidate text;
  used_keys text[];
  schema_rows jsonb;
  i integer;
  suffix integer;
begin
  for a in select id, columns from public.audiences
    where column_schema = '[]'::jsonb and cardinality(columns) > 0
  loop
    schema_rows := '[]'::jsonb;
    used_keys := '{}';
    for i in 1..cardinality(a.columns) loop
      title := coalesce(nullif(btrim(a.columns[i]), ''), 'Coluna ' || i);
      base_key := trim(both '_' from regexp_replace(lower(translate(title,
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
        '[^a-z0-9]+', '_', 'g'));
      if base_key = '' then base_key := 'campo'; end if;
      if base_key in ('nome', 'telefone', 'primeiro_nome') or base_key ~ '^coluna_[0-9]+$' then
        base_key := 'campo_' || base_key;
      end if;
      candidate := base_key;
      suffix := 2;
      while candidate = any(used_keys) loop
        candidate := base_key || '_' || suffix;
        suffix := suffix + 1;
      end loop;
      used_keys := array_append(used_keys, candidate);
      schema_rows := schema_rows || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text, 'title', title, 'key', candidate,
        'ordinal', i, 'legacy_title', a.columns[i], 'active', true
      ));
      update public.audience_contacts
        set attributes = attributes || jsonb_build_object(candidate, attributes->title)
        where audience_id = a.id and attributes ? a.columns[i] and not attributes ? candidate;
    end loop;
    update public.audiences set column_schema = schema_rows where id = a.id;
  end loop;
end $migration$;

-- Edição atômica: grava linha e trilha na mesma transação. Só service_role; o Bridge extrai
-- p_actor do JWT verificado e nunca aceita esse campo do browser.
create or replace function public.save_audience_contact(
  p_audience_id uuid, p_phone text, p_name text, p_attributes jsonb, p_actor uuid
) returns void language plpgsql security invoker set search_path = '' as $function$
declare
  old_record public.audience_contacts%rowtype;
  had_old boolean;
  field_name text;
  old_attributes jsonb;
begin
  if p_attributes is null or jsonb_typeof(p_attributes) <> 'object' then
    raise exception 'attributes deve ser objeto';
  end if;
  select * into old_record from public.audience_contacts
    where audience_id = p_audience_id and phone = p_phone for update;
  had_old := found;
  old_attributes := case when had_old then old_record.attributes else '{}'::jsonb end;

  insert into public.audience_contacts(audience_id, phone, name, attributes)
    values (p_audience_id, p_phone, p_name, p_attributes)
    on conflict (audience_id, phone) do update
      set name = excluded.name, attributes = excluded.attributes;

  if not had_old or old_record.name is distinct from p_name then
    insert into public.audience_edit_log(audience_id, contact_phone, field_key, old_value, new_value, changed_by)
      values (p_audience_id, p_phone, 'nome', case when had_old then old_record.name end, p_name, p_actor);
  end if;
  for field_name in
    select key_name from jsonb_object_keys(old_attributes || p_attributes) as keys(key_name)
  loop
    if old_attributes->>field_name is distinct from p_attributes->>field_name then
      insert into public.audience_edit_log(audience_id, contact_phone, field_key, old_value, new_value, changed_by)
        values (p_audience_id, p_phone, field_name,
          old_attributes->>field_name, p_attributes->>field_name, p_actor);
    end if;
  end loop;
end $function$;

revoke all on function public.save_audience_contact(uuid,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.save_audience_contact(uuid,text,text,jsonb,uuid) to service_role;

-- Página de contatos com busca em todas as células. Só o Bridge pode chamar.
create or replace function public.search_audience_contacts(
  p_audience_id uuid, p_query text, p_limit integer, p_offset integer,
  p_sort text default 'name', p_desc boolean default false
) returns table(phone text, name text, attributes jsonb, total_count bigint)
language sql security invoker set search_path = '' as $function$
  select c.phone, c.name, c.attributes, count(*) over () as total_count
  from public.audience_contacts c
  where c.audience_id = p_audience_id
    and (coalesce(p_query, '') = '' or c.phone ilike '%' || p_query || '%'
      or coalesce(c.name, '') ilike '%' || p_query || '%'
      or c.attributes::text ilike '%' || p_query || '%')
  order by
    case when p_sort = 'phone' and not p_desc then c.phone end asc,
    case when p_sort = 'phone' and p_desc then c.phone end desc,
    case when p_sort <> 'phone' and not p_desc then c.name end asc nulls last,
    case when p_sort <> 'phone' and p_desc then c.name end desc nulls last,
    c.phone asc
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$function$;
revoke all on function public.search_audience_contacts(uuid,text,integer,integer,text,boolean)
  from public, anon, authenticated;
grant execute on function public.search_audience_contacts(uuid,text,integer,integer,text,boolean)
  to service_role;
