# Migração social dos funis do Hub Soberano

Inventário de 11/10/2026. Este documento registra a configuração e as evidências da implantação; a existência da allowlist no código não ativa os canais sem `SOBERANO_SOCIAL_CHANNEL_IDS` no bridge.

## Canais aprovados

| Plataforma | Nome no Hub | ID do canal | Situação inicial |
| --- | --- | --- | --- |
| Facebook | campo soberano | `2e49dea3-9d93-4f5f-ad54-02882956d1ed` | Aguardando implantação |
| Facebook | Mega Sorgo Santa Elisa | `319d3aa4-26df-42bf-acbf-df440ef5981d` | Aguardando implantação |
| Instagram | Atendimento IG | `93a082b0-e169-4cf8-9b1f-6e93758bf908` | Aguardando implantação |
| Instagram | sorgo brasileiro | `1f056c55-fd58-4d55-943f-7d18c0dbc43b` | Aguardando implantação |

Instagram `david inst` tem ID `66c6120b-4f92-4e5b-9d00-312c6f43456d` e está expressamente excluído. Os IDs foram consultados na tabela `channels`, lendo apenas `id,name,type`.

## Versões e configuração

- WhatsApp 5895: `mega-sorgo-5895-20260930`.
- Quatro canais sociais: `mega-sorgo-social-20260930`.
- `SOBERANO_SOCIAL_CHANNEL_IDS`: IDs aprovados separados por vírgula. Sem a variável, nenhum canal social usa a nova rota. Durante a implantação, adicionar um ID de cada vez na ordem da tabela. ID desconhecido ou repetido desativa toda a seleção.
- O funil social antigo `mega-sorgo` permanece histórico. Nenhuma conversa antiga deve ser migrada automaticamente.

## Workflows

O inventário inicial das 14 ações 5895 está em `ops/n8n-soberano-5895-workflows.md`. A versão compartilhada, as execuções de teste e as evidências de cada canal serão registradas aqui quando cada etapa do plano for concluída. O consumidor atual é `pQFCtRhzQTKqXTjS`; ele ainda consulta apenas a versão 5895 neste ponto da implantação.
