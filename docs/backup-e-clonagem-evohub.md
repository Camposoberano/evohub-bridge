# Backup e clonagem da EvoHub

## Objetivo

Preparar uma cópia reproduzível da EvoHub sem alterar a instalação atual. A futura duplicação deverá criar uma nova infraestrutura e restaurar os dados somente depois de validar a aplicação vazia.

## Estado versionado

- Repositório: `Camposoberano/evohub-bridge`
- Branch de produção preparada: `master`
- Deploy Coolify atual: aplicação `evohub-bridge`, domínio `cofre.camposoberano.com.br`
- Base do container: `bridge/Dockerfile`
- Porta interna: `8000`

O código, migrações Supabase, testes, funis, regras de etiquetas e documentação ficam no Git. Segredos não entram no Git.

## O que precisa ser preservado

### Banco Supabase

- contatos, conversas e mensagens;
- canais e identificadores externos;
- `sales_sequences`, `scheduled_messages` e `campaign_queue`;
- eventos, entregas e auditoria;
- configurações de leads, mídias e etiquetas.

O backup é feito pelo script `ops/backup-evohub.ps1`, usando `SUPABASE_DB_URL` e o schema definido em `SUPABASE_SCHEMA`. O arquivo gerado é um dump PostgreSQL customizado e fica em `ops/backups/`, ignorado pelo Git.

No ambiente local auditado em 22/08/2026, `SUPABASE_DB_URL` está vazio. Portanto, o `pg_dump` não pode ser executado daqui ainda. A URL de banco está configurada no Coolify e deverá ser usada apenas no momento do backup, sem ser adicionada ao Git.

Como alternativa, `ops/export-evohub-rest.ts` exporta os dados operacionais pelo PostgREST quando a rede até o banco direto não estiver disponível. Esse export também fica fora do Git e não substitui o dump completo de schema.

### Supabase Storage

Buckets identificados no código:

- `soberano-config`: campanhas, contas, configuração híbrida, configuração nativa e respostas sociais;
- `soberano-out`: áudios gerados pelo bridge;
- `soberano-relay`: mídia temporária/relay;
- `chatwoot-media`: retenção de mídia recebida.

No clone, recriar os buckets e exportar os objetos antes de ativar os funis.

### Integrações e segredos

Registrar em cofre seguro, nunca em commit:

- `SUPABASE_*`;
- `CHATWOOT_*`;
- `UAZAPI_*`;
- `META_*`;
- `EVOLUTION_HUB_*`;
- `COOLIFY_*`;
- chaves de IA e Prompt Cache.

Para cada segredo, registrar origem, finalidade, expiração e se precisa ser rotacionado no clone.

## Procedimento futuro

1. Gerar dump e manifest com `ops/backup-evohub.ps1`.
2. Exportar os objetos dos buckets do Storage.
3. Criar a nova VPS e instalar Coolify.
4. Criar a aplicação apontando para `master` e confirmar o commit antes do deploy.
5. Restaurar banco, migrações e Storage.
6. Copiar variáveis para o novo ambiente, gerando novos webhooks e secrets quando necessário.
7. Configurar domínios de teste e não apontar produção ainda.
8. Validar `/health`, `/version`, inbound, outbound, mídia, etiquetas e filas.
9. Reconectar Chatwoot, UAZAPI e Meta um por vez.
10. Fazer homologação com contatos internos.
11. Só depois trocar DNS e ativar campanhas.

## Critério de prontidão

A clonagem só está pronta quando o novo ambiente consegue responder a um teste de entrada, enviar uma mensagem controlada, restaurar uma conversa de teste, aplicar `SUL`, respeitar `Pago`/`Não COMPRA` e iniciar um funil sem duplicidade.

## Rollback

Manter a instalação atual intacta. Em caso de falha, retirar o DNS do clone e continuar usando a origem. Não revogar tokens nem apagar a origem até a nova VPS passar pela homologação e pelo período de observação definido.
