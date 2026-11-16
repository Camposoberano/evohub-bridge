-- 0029_response_priority.sql — Prioridade nativa do Chatwoot por tempo sem resposta humana.
-- Portado do hub CECAPE (0017_response_priority), generalizado. Rodar no Supabase Studio.
-- Idempotente, multi-schema (public/evohub). Adiciona colunas à conversations + trigger que
-- marca last_customer_message_at a cada mensagem de ENTRADA. O bridge (reply-priority) escala a
-- prioridade nativa conforme o tempo sem resposta humana.

create or replace function public.track_customer_response_priority()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.direction = 'in' then
    execute pg_catalog.format(
      'update %I.conversations set last_customer_message_at = greatest(coalesce(last_customer_message_at, $1), $1) where id = $2',
      TG_TABLE_SCHEMA
    ) using new.sent_at, new.conversation_id;
  end if;
  return new;
end;
$$;
revoke all on function public.track_customer_response_priority() from PUBLIC, anon, authenticated;

do $$
declare target_schema text;
begin
  foreach target_schema in array array['public', 'evohub'] loop
    if to_regclass(format('%I.conversations', target_schema)) is null
       or to_regclass(format('%I.messages', target_schema)) is null
       or not exists (
         select 1 from information_schema.columns
         where table_schema = target_schema and table_name = 'conversations'
           and column_name = 'bot_muted_at'
       ) then continue;
    end if;
    execute format('alter table %I.conversations add column if not exists last_customer_message_at timestamptz', target_schema);
    execute format('alter table %I.conversations add column if not exists last_human_reply_at timestamptz', target_schema);
    execute format('alter table %I.conversations add column if not exists response_priority_level smallint not null default 0 check (response_priority_level between 0 and 4)', target_schema);
    execute format('create index if not exists idx_conversations_response_priority on %I.conversations (last_customer_message_at desc) where last_customer_message_at is not null', target_schema);
    execute format('drop trigger if exists trg_customer_response_priority on %I.messages', target_schema);
    execute format('create trigger trg_customer_response_priority after insert on %I.messages for each row execute function public.track_customer_response_priority()', target_schema);
  end loop;
end;
$$;
