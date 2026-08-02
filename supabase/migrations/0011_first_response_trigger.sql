-- 0011_first_response_trigger.sql
-- conversations.first_response_at existe desde 0001_init.sql e nunca foi escrita: nenhum dos
-- ~16 pontos que inserem messages(direction='out') no bridge (hub-webhook, send-outbound,
-- catalog, chatwoot-webhook, sync-facebook) grava essa coluna. Consequência prática:
-- metrics-rollup.avg_first_response_s ficou marcado "TODO Fase 4" desde sempre porque não
-- havia dado nenhum pra agregar.
--
-- Em vez de instrumentar cada um dos pontos de envio (superfície grande, risco de esquecer
-- um caminho e o dado ficar incompleto de novo), o gatilho fica no banco: roda pra QUALQUER
-- insert em messages com direction='out', em qualquer schema/app que grave nessa tabela.
--
-- Regra: só conta como "primeira resposta" quando já existe pelo menos uma mensagem de
-- entrada na conversa antes dela (não conta a mensagem de abertura/apresentação do próprio
-- bot como resposta a nada) e quando a conversa ainda não tem first_response_at (idempotente:
-- reentrega/retry do mesmo envio não altera o valor já gravado).

create or replace function mark_first_response()
returns trigger as $$
begin
  if new.direction <> 'out' then
    return new;
  end if;

  update conversations
  set first_response_at = new.sent_at
  where id = new.conversation_id
    and first_response_at is null
    and exists (
      select 1 from messages
      where conversation_id = new.conversation_id
        and direction = 'in'
        and sent_at <= new.sent_at
        and id <> new.id
    );

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_mark_first_response on messages;
create trigger trg_mark_first_response
  after insert on messages
  for each row
  execute function mark_first_response();

-- Backfill: conversas que já têm troca in->out no histórico, mas nunca tiveram
-- first_response_at calculado (a coluna só passa a ser preenchida a partir de agora
-- pelo trigger). Usa a primeira mensagem 'out' que tem uma 'in' anterior na mesma conversa.
with first_out as (
  select distinct on (m_out.conversation_id)
    m_out.conversation_id,
    m_out.sent_at
  from messages m_out
  where m_out.direction = 'out'
    and exists (
      select 1 from messages m_in
      where m_in.conversation_id = m_out.conversation_id
        and m_in.direction = 'in'
        and m_in.sent_at <= m_out.sent_at
    )
  order by m_out.conversation_id, m_out.sent_at asc
)
update conversations c
set first_response_at = first_out.sent_at
from first_out
where c.id = first_out.conversation_id
  and c.first_response_at is null;
