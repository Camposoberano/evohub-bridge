-- Tabela `clientes` -- lista fria importada (xlsx) + enriquecida via uazapi (bridge/shared/enrich.ts).
-- Já existe em produção (criada na mão no Studio); migration documenta o schema atual
-- pra versionar e permitir recriar em ambiente novo. `if not exists` -- no-op em produção.
create table if not exists clientes (
  phone text primary key,
  in_list1 boolean not null default false,
  in_list2 boolean not null default false,
  source_number text,
  enrich_status text not null default 'pending', -- pending -> checked|no_wa -> done
  on_whatsapp boolean,
  jid text,
  lid text,
  verified_name text,
  wa_name text,
  wa_contact_name text,
  image_url text,
  image_preview text,
  common_groups integer,
  lead_name text,
  lead_tags text,
  labels text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_clientes_enrich_status on clientes(enrich_status);
create index if not exists idx_clientes_on_whatsapp on clientes(on_whatsapp);
create index if not exists idx_clientes_source_number on clientes(source_number);
