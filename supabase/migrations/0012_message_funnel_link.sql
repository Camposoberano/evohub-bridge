-- 0012_message_funnel_link.sql
-- messages não tem nenhuma coluna que ligue uma mensagem de saída do funil à etapa que a
-- gerou, nem a resposta do lead à mensagem que a provocou. Hoje é impossível responder
-- "qual mensagem da sequência faz o lead responder" -- só dá pra olhar a conversa toda.
-- Colunas nullable, sem backfill (histórico não tem como saber a que dia/step pertenceu
-- cada envio do funil retroativamente com segurança).

alter table messages
  add column if not exists funnel text,
  add column if not exists funnel_day integer,
  add column if not exists funnel_step text,
  add column if not exists scheduled_message_id uuid;

create index if not exists idx_messages_scheduled_message_id
  on messages (scheduled_message_id)
  where scheduled_message_id is not null;

create index if not exists idx_messages_funnel_day
  on messages (funnel, funnel_day)
  where funnel is not null;

comment on column messages.funnel is 'Nome do funil (ex: mega-sorgo) quando o envio veio de scheduled_messages. Null pra mensagem avulsa/manual.';
comment on column messages.funnel_day is 'Dia da sequência (scheduled_messages.day) quando o envio veio do funil.';
comment on column messages.funnel_step is 'Tipo/step do envio (scheduled_messages.type) quando o envio veio do funil.';
comment on column messages.scheduled_message_id is 'FK lógica pra scheduled_messages.id (tabela sem DDL versionado neste repo) -- elo entre a mensagem enviada e a peça da fila que a originou.';
