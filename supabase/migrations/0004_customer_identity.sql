-- Identidade global de cliente.
-- contacts continua sendo a identidade por canal; customers agrupa os canais
-- somente quando existe um telefone normalizado ou uma identidade deterministica.
create table if not exists customers (
  id              uuid primary key default gen_random_uuid(),
  identity_key    text not null unique,
  canonical_phone text,
  display_name    text,
  avatar_url      text,
  attributes      jsonb not null default '{}'::jsonb,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_customers_phone on customers(canonical_phone);
create index if not exists idx_customers_last_seen on customers(last_seen_at desc);
drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();

alter table contacts add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists idx_contacts_customer on contacts(customer_id);

alter table clientes add column if not exists customer_id uuid references customers(id) on delete set null;
create index if not exists idx_clientes_customer on clientes(customer_id);

-- Preenche primeiro as identidades de telefone e depois as identidades sem telefone.
-- A chave de BSUID/PSID/IG sem telefone permanece isolada por canal para evitar fusao indevida.
insert into customers (identity_key, canonical_phone, display_name, first_seen_at, last_seen_at)
select identity_key, max(phone), max(name), min(first_seen_at), max(last_seen_at)
from (
  select
    case when regexp_replace(coalesce(phone, external_contact_id), E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
      then 'phone:' || regexp_replace(coalesce(phone, external_contact_id), E'\\D', '', 'g')
      else 'channel:' || channel_id::text || ':' || external_contact_id end as identity_key,
    case when regexp_replace(coalesce(phone, external_contact_id), E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
      then '+' || regexp_replace(coalesce(phone, external_contact_id), E'\\D', '', 'g') end as phone,
    name, first_seen_at, last_seen_at
  from contacts
  union all
  select
    'phone:' || regexp_replace(phone, E'\\D', '', 'g'),
    '+' || regexp_replace(phone, E'\\D', '', 'g'),
    coalesce(lead_name, wa_name, wa_contact_name, verified_name), created_at, updated_at
  from clientes
  where regexp_replace(phone, E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
) source
group by identity_key
on conflict (identity_key) do update set
  canonical_phone = coalesce(customers.canonical_phone, excluded.canonical_phone),
  display_name = coalesce(customers.display_name, excluded.display_name),
  first_seen_at = least(customers.first_seen_at, excluded.first_seen_at),
  last_seen_at = greatest(customers.last_seen_at, excluded.last_seen_at);

update contacts c
set customer_id = x.id
from customers x
where x.identity_key = case
  when regexp_replace(coalesce(c.phone, c.external_contact_id), E'\\D', '', 'g') ~ '^[0-9]{10,15}$'
    then 'phone:' || regexp_replace(coalesce(c.phone, c.external_contact_id), E'\\D', '', 'g')
  else 'channel:' || c.channel_id::text || ':' || c.external_contact_id
end
and c.customer_id is distinct from x.id;

update clientes c
set customer_id = x.id
from customers x
where x.identity_key = 'phone:' || regexp_replace(c.phone, E'\\D', '', 'g')
and c.customer_id is distinct from x.id;

-- Novas importacoes da lista fria entram automaticamente no cadastro global.
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

drop trigger if exists trg_clientes_customer on clientes;
create trigger trg_clientes_customer before insert or update of phone on clientes
  for each row execute function assign_cliente_customer();

alter table customers enable row level security;
drop policy if exists customers_read on customers;
create policy customers_read on customers for select to authenticated using (true);
