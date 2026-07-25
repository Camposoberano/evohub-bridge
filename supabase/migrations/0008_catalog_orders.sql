-- 0008_catalog_orders.sql
-- Catálogo de produtos Campo Soberano (66 produtos / Demetra) + orçamento/pedido via WhatsApp.
-- Tudo referencia conversations.id (hub operacional), não clientes (lista fria).

-- ─────────────────────────────────────────────────────────────────────────────
-- product_categories: grupo (nível 1 do menu) + categoria (nível 2)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists product_categories (
  id            uuid primary key default gen_random_uuid(),
  group_name    text not null,             -- ex.: 'Pastagens e Pecuária'
  group_slug    text not null,             -- ex.: 'pastagens'
  name          text not null,             -- ex.: 'Braquiárias'
  slug          text not null unique,      -- ex.: 'braquiarias'
  sort_order    int not null default 0,
  active        boolean not null default true,
  blocked_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_product_categories_group on product_categories(group_slug);
drop trigger if exists trg_product_categories_updated on product_categories;
create trigger trg_product_categories_updated before update on product_categories
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- products: os 66 produtos (64 ativos + 2 legados bloqueados)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  category_id         uuid not null references product_categories(id) on delete restrict,
  sku                 text not null unique,       -- código interno da planilha
  name                text not null,               -- nome comercial
  short_name          text,                        -- nome reduzido pro menu (limite ~24 char do WhatsApp)
  description         text,                        -- descrição comercial
  target_audience     text,
  planting_season     text,
  region              text,
  needs_zoning        boolean not null default false,
  usage_objective     text,                        -- "Objetivo/uso" da planilha
  differentiators     text,                        -- "Características e diferenciais"
  farmer_benefits     text,                        -- "Vantagens para o produtor"
  reseller_benefits   text,                        -- "Vantagens para a revenda/parceiro"
  pain_point          text,                        -- "Dor que resolve"
  sales_angle         text,
  hook                text,
  cta                 text,
  keyword             text,                        -- pra futura detecção de intenção por texto livre
  auto_reply          text,                        -- mensagem de apresentação já pronta (ficha comercial)
  media_notes         text,                        -- "Mídias necessárias" (texto livre da planilha)
  required_media      jsonb not null default '[]'::jsonb,
  content_status      jsonb not null default '{}'::jsonb,  -- ficha/fotos/vídeo/copy/aprovação (produção)
  validation_status   text not null default 'pending',      -- texto livre da coluna "Validação" da planilha
  risk_classification text,                        -- "Risco": Baixo/Moderado/Alto
  site_status         text,                        -- "Status no site" (sinaliza duplicidade TAMANI/ZURI etc.)
  status              text not null default 'active', -- active | legacy_blocked
  source_url          text,
  notes               text,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_status    on products(status) where status = 'active';
drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- catalog_nav_state: nível/seleção atual do contato na navegação do menu
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists catalog_nav_state (
  conversation_id     uuid primary key references conversations(id) on delete cascade,
  level               text not null default 'root', -- root|group|category|product|action
  selected_group_slug text,
  selected_category_id uuid references product_categories(id) on delete set null,
  selected_product_id  uuid references products(id) on delete set null,
  updated_at          timestamptz not null default now()
);
drop trigger if exists trg_catalog_nav_state_updated on catalog_nav_state;
create trigger trg_catalog_nav_state_updated before update on catalog_nav_state
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- leads_qualification: qualificação progressiva (objetivo/região/hectares/plantio)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists leads_qualification (
  id                    uuid primary key default gen_random_uuid(),
  conversation_id       uuid not null unique references conversations(id) on delete cascade,
  product_id            uuid references products(id) on delete set null,
  objective             text,
  region                text,
  hectares              numeric,
  planting_date         date,
  qualification_stage   text not null default 'started', -- started|objective|region|hectares|date|complete
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
drop trigger if exists trg_leads_qualification_updated on leads_qualification;
create trigger trg_leads_qualification_updated before update on leads_qualification
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- quotes (orçamento)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists quotes (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references conversations(id) on delete cascade,
  product_id             uuid not null references products(id) on delete restrict,
  lead_qualification_id  uuid references leads_qualification(id) on delete set null,
  stage                  text not null default 'lead_qualificado',
  -- lead_qualificado -> orcamento_solicitado -> validacao_comercial -> proposta_enviada -> aguardando_pagamento
  requested_qty          numeric,
  unit                   text,
  price_cents            bigint,
  freight_cents          bigint,
  total_cents            bigint,
  validated_by           text,
  validated_at           timestamptz,
  proposal_sent_at       timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index if not exists idx_quotes_conversation on quotes(conversation_id);
create index if not exists idx_quotes_stage         on quotes(stage);
drop trigger if exists trg_quotes_updated on quotes;
create trigger trg_quotes_updated before update on quotes
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- orders (pedido)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists orders (
  id                uuid primary key default gen_random_uuid(),
  quote_id          uuid not null references quotes(id) on delete restrict,
  conversation_id   uuid not null references conversations(id) on delete cascade,
  stage             text not null default 'proposta_aceita',
  -- proposta_aceita -> dados_faturamento_coletados -> pix_enviado -> pagamento_confirmado -> pedido_confirmado | cancelado
  billing_doc       text,     -- CPF/CNPJ — só coletado a partir daqui
  billing_name      text,
  delivery_address  jsonb,
  pix_reference     text,
  confirmed_by      text,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_orders_conversation on orders(conversation_id);
create index if not exists idx_orders_quote         on orders(quote_id);
create index if not exists idx_orders_stage         on orders(stage);
drop trigger if exists trg_orders_updated on orders;
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: authenticated lê; service_role escreve (bypassa RLS) — mesmo padrão do 0001.
-- ─────────────────────────────────────────────────────────────────────────────
alter table product_categories  enable row level security;
alter table products            enable row level security;
alter table catalog_nav_state   enable row level security;
alter table leads_qualification enable row level security;
alter table quotes              enable row level security;
alter table orders              enable row level security;

do $$
declare t text;
begin
  foreach t in array array['product_categories','products','leads_qualification','quotes','orders']
  loop
    execute format('drop policy if exists %I on %I;', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (true);', t || '_read', t);
  end loop;
end $$;
-- catalog_nav_state é estado efêmero de navegação, sem policy = authenticated negado (só service_role).
