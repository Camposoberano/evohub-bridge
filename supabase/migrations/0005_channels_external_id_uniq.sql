-- unique parcial em channels.external_id (null-safe) -- precisa pra upsert por external_id
-- (painel ryzeapi grava/atualiza o canal pelo nome da instância).
create unique index if not exists channels_external_id_uniq
  on channels (external_id) where external_id is not null;
