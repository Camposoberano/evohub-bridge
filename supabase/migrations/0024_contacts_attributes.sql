-- 0024_contacts_attributes.sql
-- Coluna de atributos por contato: onde o nó `input` do fluxo grava a resposta aberta do lead
-- (ex.: {{cidade}}, {{nota}}), lida depois por varsDoContato para interpolar nos próximos steps.
-- Também é onde o sync de perfil (Fase 4) guarda jid/lid/nome-source etc.
-- Rodar no Supabase Studio (SQL Editor) — DDL manual.

alter table contacts
  add column if not exists attributes jsonb not null default '{}'::jsonb;
