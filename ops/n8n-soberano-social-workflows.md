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

O inventário inicial das 14 ações 5895 está em `ops/n8n-soberano-5895-workflows.md`. A tabela abaixo registra as versões ativas lidas via MCP do n8n Soberano em 11/10/2026, antes da alteração multicanal. Nenhum workflow foi alterado por esta leitura.

| Ação | ID n8n | Versão ativa inicial |
| --- | --- | --- |
| funil | `Gi816kZhzzlSZGbG` | `1e3b93b9-9620-43f3-950a-675d807e747f` |
| preco | `LpIJzlfzIQVb6m1b` | `089c2bfb-2ebf-475b-bc53-94b126ebff0d` |
| video | `tHXWvor101ACf9Uk` | `d5a2f5f2-8fa6-4719-a502-339150d6cde1` |
| plantio | `UFn1CDKL2ZIDHqFh` | `d29ef95e-fba6-4901-8e66-2158381082c9` |
| nutricao | `VMNm5NS9YvSkKR0n` | `c9d71c54-aa20-4246-9326-c65bf1ef4fda` |
| recuperacao-1 | `ScpS8QFJ0mUe2VqV` | `fbce289a-bd36-4b07-8d63-265de4ccd743` |
| recuperacao-2 | `OKSLDm55eSBCM9fT` | `66106c37-2f31-4ad1-a1ef-fd10c6a4cd89` |
| recuperacao-3 | `oqKTRZtRM7iWPGig` | `1ec68ec5-f310-4f2a-a682-52140865f6bc` |
| recuperacao-4 | `SjGRW2ItnLVqtxPd` | `6832acef-6834-4b1d-8807-b7eced5b949f` |
| catalogo | `Jybjc2MAL1uQt1lb` | `06021b57-f64f-4e96-beae-35cf35dd7042` |
| catalogo-sair | `ElTVXX90R4KjdgSx` | `148e8874-032c-4f97-9a71-f64d0c52ca76` |
| pause | `UEG65que4bk3bO1u` | `07d1ff65-5f76-4d9b-94d1-a9825beea140` |
| resume | `7lR1VkUeUdeDu4T7` | `6315b40a-1ce1-40cb-9293-3daefcf0a1ab` |
| stop | `ChaOmWGgdbXAyLOs` | `c9c9524d-1844-49d2-9b8d-6c47dc55e88e` |

Consumidor atual: `pQFCtRhzQTKqXTjS`, versão `60314200-5c2f-4544-ae3d-39abb7f1a392`. Na leitura inicial, ele consultava só `mega-sorgo-5895-20260930` e carregava cabeçalhos de acesso ao banco e um token do bridge diretamente nos parâmetros dos nós. A migração deve trocar essa consulta por `GET /n8n-queue` e o envio por `POST /n8n-queue`, usando a credencial HTTP Bearer `Soberano 5895 bridge enqueue` (`lgsd3kpkAJeb4aVv`), sem copiar segredos para este documento. Esses endpoints só expõem IDs vencidos e validam a peça no bridge.

## Checkpoint de 11/10/2026

As 14 ações foram publicadas com a mesma validação anterior do 5895 acrescida da versão `mega-sorgo-social-20260930`. A comparação do nó de código de cada workflow com sua versão ativa anterior confirmou que apenas essa expressão de validação mudou; as peças, preços, mídia e offsets permaneceram idênticos. As versões ativas novas, na ordem da tabela, são:

`a2adadca-414b-41bf-b2af-f7446674bee3`, `e2892991-ae6d-41eb-b8ae-55fa0d073ccd`, `92fd7b94-ec39-4678-a3c9-a4616a3650d2`, `5fcce066-4f14-4d4c-b0b1-019b71d025e4`, `5cf81496-6c75-4fec-a6a7-f6bf2de867a5`, `8247fd1d-e4f4-4c56-96f0-109d6a41b5bb`, `d256a40f-53a5-4a06-893c-842840ff6695`, `e6a1e2fe-aec3-4a4c-b30a-64623fe28963`, `f5b1501a-a545-4dcb-a48e-5227a713ae58`, `930f5dce-e1c7-4515-9a6c-013e149d9e2f`, `03a49253-5256-4235-920d-ff4f2557ba25`, `5f5930d5-3c32-4385-b733-05d0e804dca0`, `73059803-e7a6-4450-840e-271ac1399141`, `411fa518-b421-4561-923c-d3d3aadee7c0`.

O consumidor `pQFCtRhzQTKqXTjS` mantém publicada a versão `60314200-5c2f-4544-ae3d-39abb7f1a392`, que atende somente o 5895. No rascunho `2e56adb5-a9c8-4162-845d-85b8a1f307c0`, a credencial Bearer existente foi selecionada visualmente nos dois nós HTTP, sem trocar URLs ou publicar. O MCP recusou a associação direta da credencial, e a revisão automática bloqueou trocar os endpoints sem comprovação da associação e da disponibilidade do novo endpoint. A fila ativa não foi alterada. A próxima etapa é implantar o bridge, conferir `/n8n-queue` com essa credencial e somente então atualizar e publicar o consumidor.

O código local passou 65 testes dirigidos, `deno check` dos endpoints e `next build` do painel. Os quatro canais sociais ainda não foram habilitados; não há evidência de envio real social neste checkpoint.
