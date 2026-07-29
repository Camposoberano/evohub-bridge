-- 0010_catalog_journey_prices.sql
-- Separa o contexto do catalogo da jornada Mega Sorgo e cria a fonte de
-- precos aprovados por produto. Nenhum produto pode herdar preco de outro.

alter table catalog_nav_state
  add column if not exists journey text;

-- Estados criados antes desta migracao vieram do detector automatico antigo.
-- Eles nao devem manter o catalogo ativo depois da separacao.
update catalog_nav_state
set journey = 'mega_sorgo'
where journey is null;

alter table catalog_nav_state
  alter column journey set default 'mega_sorgo';
alter table catalog_nav_state
  alter column journey set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_nav_state_journey_check'
  ) then
    alter table catalog_nav_state
      add constraint catalog_nav_state_journey_check
      check (journey in ('mega_sorgo', 'catalogo'));
  end if;
end $$;

create index if not exists idx_catalog_nav_state_journey
  on catalog_nav_state(journey);

create table if not exists product_prices (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  variant     text,
  unit        text not null,
  price_cents bigint not null check (price_cents >= 0),
  currency    text not null default 'BRL',
  region      text not null default 'BR',
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,
  active      boolean not null default true,
  approved_by text,
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from)
);

create index if not exists idx_product_prices_lookup
  on product_prices(product_id, active, valid_from, valid_until);

drop trigger if exists trg_product_prices_updated on product_prices;
create trigger trg_product_prices_updated before update on product_prices
  for each row execute function set_updated_at();

alter table product_prices enable row level security;

drop policy if exists product_prices_read on product_prices;
create policy product_prices_read
  on product_prices for select to authenticated
  using (active = true and approved_at is not null);

comment on table product_prices is
  'Precos comerciais aprovados por produto, variante, regiao e vigencia.';
comment on column catalog_nav_state.journey is
  'Jornada ativa da conversa; impede mistura entre catalogo e Mega Sorgo.';
