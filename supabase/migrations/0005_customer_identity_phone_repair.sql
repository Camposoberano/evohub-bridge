-- Corrige backfills executados antes da normalizacao E'\\D' e religa contatos
-- do mesmo telefone em canais diferentes ao mesmo customer global.
insert into customers (identity_key, canonical_phone, display_name, first_seen_at, last_seen_at)
select 'phone:' || digits, '+' || digits, max(name), min(first_seen_at), max(last_seen_at)
from (
  select regexp_replace(coalesce(phone, external_contact_id), E'\\D', '', 'g') as digits,
    name, first_seen_at, last_seen_at
  from contacts
  union all
  select regexp_replace(phone, E'\\D', '', 'g'),
    coalesce(lead_name, wa_name, wa_contact_name, verified_name), created_at, updated_at
  from clientes
) rows
where digits ~ '^[0-9]{10,15}$'
group by digits
on conflict (identity_key) do update set
  canonical_phone = coalesce(customers.canonical_phone, excluded.canonical_phone),
  display_name = coalesce(customers.display_name, excluded.display_name),
  first_seen_at = least(customers.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(customers.last_seen_at, excluded.last_seen_at);

update contacts c
set customer_id = x.id
from customers x
where x.identity_key = 'phone:' || regexp_replace(coalesce(c.phone, c.external_contact_id), E'\\D', '', 'g')
and regexp_replace(coalesce(c.phone, c.external_contact_id), E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
and c.customer_id is distinct from x.id;

update clientes c
set customer_id = x.id
from customers x
where x.identity_key = 'phone:' || regexp_replace(c.phone, E'\\D', '', 'g')
and regexp_replace(c.phone, E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
and c.customer_id is distinct from x.id;

create or replace function assign_cliente_customer()
returns trigger language plpgsql as $$
declare
  key text;
  cid uuid;
  digits text;
begin
  digits := regexp_replace(new.phone, E'\\D', '', 'g');
  if digits !~ '^[0-9]{10,15}$' then return new; end if;
  key := 'phone:' || digits;
  insert into customers (identity_key, canonical_phone)
  values (key, '+' || digits)
  on conflict (identity_key) do nothing;
  select id into cid from customers where identity_key = key;
  new.customer_id := cid;
  return new;
end;
$$;
