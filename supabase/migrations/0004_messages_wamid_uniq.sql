-- Reforço de dedup pra mensagens (channel_id + meta_message_id). Não muda código de envio/
-- recebimento -- só impede no banco que 2 linhas com o mesmo wamid+canal coexistam, caso
-- algum caminho futuro insira sem passar pelo claimDelivery() do bridge.
-- "where meta_message_id is not null" porque mensagens sem wamid (ex: falha de envio antes
-- de ter resposta da Meta) podem ter null e não devem colidir entre si.
create unique index if not exists messages_chan_wamid_uniq
  on messages(channel_id, meta_message_id)
  where meta_message_id is not null;
