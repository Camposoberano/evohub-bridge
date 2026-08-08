-- 0013_bot_mute.sql
-- Trava do bot por conversa. Hoje a única forma de calar o bot é a label cmd-funil-pause,
-- que o macro-poll APAGA depois de executar: não sobra rastro, então não dá pra olhar a
-- lista do Chatwoot e saber quais conversas estão paradas nem há quanto tempo. Além disso
-- ela só para o funil agendado — as respostas automáticas de preço/plantio continuam
-- saindo por cima do atendente.
--
-- A label `bot-off` passa a ser o estado (persistente, não removida), e esta coluna é o
-- espelho local dela: o loop de reconciliação grava quando a label aparece e limpa quando
-- some. Consultar aqui evita bater na API do Chatwoot a cada mensagem que chega.
--
-- timestamptz e não boolean: guarda QUANDO travou, o que permite depois alertar sobre
-- conversa esquecida travada (o cliente falando e ninguém respondendo).

alter table conversations
  add column if not exists bot_muted_at timestamptz;

create index if not exists idx_conversations_bot_muted_at
  on conversations (bot_muted_at)
  where bot_muted_at is not null;

comment on column conversations.bot_muted_at is 'Quando o bot foi silenciado nesta conversa (label bot-off no Chatwoot). Null = bot ativo. Enquanto preenchido: funil agendado, respostas automáticas de intenção e cadeia de recuperação ficam bloqueados; a mensagem do cliente continua sendo gravada e espelhada normalmente.';
