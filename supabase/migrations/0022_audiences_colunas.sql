-- Públicos como tabela editável: colunas extras (além de nome/telefone) + atributos por contato.
-- Portado do hub CECAPE.
-- `audiences.columns` = nomes das colunas extras (ex.: {cidade, curso}); cada contato guarda os
-- valores dessas colunas em `audience_contacts.attributes` (JSONB {coluna: valor}).
-- Rodar no Supabase Studio após 0021.

alter table public.audiences
  add column if not exists columns text[] not null default '{}';

alter table public.audience_contacts
  add column if not exists attributes jsonb not null default '{}'::jsonb;
