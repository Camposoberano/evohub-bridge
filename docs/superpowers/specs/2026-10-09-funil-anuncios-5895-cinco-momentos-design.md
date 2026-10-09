# Funil de anúncios 5895 — cinco momentos

## Status

Publicada em produção em 09/10/2026. Build ativo:
`2026-10-09-funil-anuncios-5895-cinco-momentos`.

## Objetivo

Garantir que todo novo lead identificado como vindo de anúncio no WhatsApp 5895
entre no funil comercial curto. Respostas a preço, uso, plantio e outras
intenções devem ocorrer entre os momentos do funil e não cancelar as mensagens
futuras.

## Diagnóstico de 09/10/2026

- Foram encontradas cinco conversas de anúncio, Chatwoot #3500–3504.
- Quatro receberam a abertura ativa de duas mensagens.
- Na #3500, a primeira pergunta foi sobre preço. O código marcou as duas
  mensagens como abertura genérica e as removeu da fila; como não sobrou
  mensagem, retornou antes de criar a sequência. Não houve tentativa de entrega
  nem erro do WhatsApp.
- No caso apontado pelo usuário em 09/10, a sequência antiga já estava ativa com
  duas peças marcadas `sent`. O comando manual não duplicou a sequência, mas a
  nota tratou o registro de envio como confirmação de entrega; o status não
  tinha recibo `delivered` ou `read`.
- O cadastro ativo continha somente `faseComercialV2`, com duas peças. As cinco
  fases legadas contêm várias peças cada e não são uma substituição enxuta.
- O roteiro legado e algumas respostas comerciais mantêm alegações incompatíveis
  ou desatualizadas, incluindo “30%” de desconto e promessas
  agronômicas/logísticas sem validação atual. Essas alegações não entram na
  régua nova.

## Decisões de produto

1. Limitar a inscrição automática a novos leads de anúncio no WhatsApp 5895,
   usando os sinais de origem confiáveis já reconhecidos pelo sistema.
2. Substituir a régua ativa de duas mensagens por exatamente cinco envios
   agendados: um envio curto em cada momento. Nenhuma fase pode expandir para
   vários áudios, imagens, vídeos ou mensagens em sequência.
3. Manter os intervalos atuais do agendador (`0`, `30 min`, `6 h`, `12 h`,
   `12 h`, contados em tempo útil) e a janela operacional de 06h–22h BRT. Os
   cinco momentos são distribuídos pelo agendador existente; cada momento contém
   uma única peça.
4. Tratar a intenção da conversa em paralelo: uma pergunta de preço aciona
   imediatamente o handler comercial, e o funil mantém as etapas futuras. A
   pergunta ou resposta direta não marca a sequência como concluída nem cancela
   a fila.
5. Se chegar uma nova mensagem enquanto uma etapa estiver prestes a sair,
   aplicar a pausa operacional existente e retomar as etapas pendentes após o
   período de silêncio, sem reiniciar do começo ou duplicar conteúdo já enviado.
6. Uma conversa só deixa a régua por condição terminal explícita já suportada
   pelo produto, como opt-out, venda confirmada ou cancelamento/pausa manual.
   Pedido de preço, cotação ou informação não é condição terminal. Um handoff
   humano pode pausar os próximos envios enquanto o atendimento estiver ativo,
   mas não pode apagar a sequência.
7. Criar a régua em texto curto, sem preço numérico, percentuais de desconto ou
   alegações de produtividade, altura, resistência à seca, número de cortes ou
   frete que não tenham fonte operacional validada. Não reutilizar mídias
   legadas sem aprovação atual.
8. Não iniciar automaticamente o novo roteiro em conversas históricas. O lead
   #3500 já recebeu respostas de preço e cotação; qualquer retomada dessa
   conversa será uma operação separada, evitando duplicidade.

## Conteúdo proposto

Cada mensagem deve caber em poucas linhas, ter um único propósito e não repetir
uma informação que o lead já deu. Se a intenção já estiver conhecida, adaptar o
texto do momento sem removê-lo da sequência.

| Momento          | Propósito                                  | Rascunho curto                                                                                                                                 |
| ---------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — entrada      | Identificar o atendimento e abrir conversa | “Olá! Aqui é o Cícero, da Campo Soberano. Vi que você chegou pelo anúncio do Mega Sorgo Santa Elisa. Como posso te ajudar?”                    |
| 2 — finalidade   | Entender o uso sem presumir necessidade    | “Você pretende usar o sorgo para silagem, pastejo ou outra finalidade?” Se já informou o uso, reconhecer e avançar sem repetir a pergunta.     |
| 3 — necessidade  | Coletar informação para orientar           | “Para eu te orientar melhor, em qual cidade fica a área?” Só perguntar se região/contexto ainda não estiver informado.                         |
| 4 — quantidade   | Ajudar a dimensionar a opção               | “Para referência: 1 hectare corresponde a 4 kg; 2 hectares, a 10 kg; e 4 hectares, a 20 kg. O Cícero confirma a opção adequada para sua área.” |
| 5 — continuidade | Oferecer o próximo passo                   | “Quer pedir uma cotação ou tirar outra dúvida? Responda por aqui que a conversa continua com a equipe.”                                        |

Uma resposta de preço permanece no handler existente e pode sair entre esses
momentos. Antes da publicação, alinhar o texto desse handler para não repetir a
alegação conflitante de 30%; se as regras atuais de desconto não puderem ser
confirmadas na fonte operacional, não declarar percentual.

## Escopo

- Inclui inscrição, persistência da sequência, roteamento de intenção entre os
  momentos, pausa/retomada, proteção contra duplicidade e medição dos cinco
  envios.
- Inclui somente o fluxo automático para leads novos do WhatsApp 5895.
- Inícios manuais no canal 5895 também usam os cinco momentos para que a
  abertura antiga de duas mensagens não seja enviada por esse canal. Outros
  canais preservam o comportamento atual.
- Não altera campanhas de disparo em massa, outros canais, catálogo geral, mídia
  ativa ou valores da tabela comercial.
- Não reenvia mensagens já enviadas nem matricula a base histórica como efeito
  colateral.

## Critérios de aceite

1. Uma primeira mensagem de anúncio perguntando preço cria a sequência de cinco
   momentos e recebe a resposta comercial existente, sem perder nenhuma etapa
   futura.
2. Mensagem sem intenção também cria a mesma sequência, sem gerar mensagens
   agrupadas por momento.
3. Um novo inbound durante a sequência aciona o handler correspondente; as
   mensagens restantes continuam pausadas e depois retomam sem duplicidade.
4. Os cinco envios pertencem ao funil `mega-sorgo-5895-v2`, ao canal 5895 e respeitam o
   horário operacional configurado.
5. Opt-out, venda confirmada e pausa manual mantêm as proteções terminais;
   pedido de preço/ajuda não cancela a régua.
6. A abertura antiga `faseComercialV2` de duas peças não é usada em nenhuma
   inscrição no canal 5895; as cinco fases longas não são usadas para novas
   inscrições.
7. O texto agendado não contém preço numérico, “30%”, nem promessas
   técnicas/logísticas legadas sem validação.
8. Reentregas concorrentes continuam idempotentes; sequência e eventos permitem
   verificar inscrição, envio, pausa, retomada e encerramento.
9. O deploy é identificado por `/version` e confirmado por `/health`. A
   validação automatizada cobre entrada de anúncio com preço, resposta entre
   etapas, retomada, contagem de cinco envios e bloqueios terminais.
10. O comando manual não duplica sequência ativa e sua nota diferencia evidência
    de envio de confirmação de entrega ao aparelho.

## Operação e migração

- Antes do deploy, conferir se há linhas `pending` ou `paused` do roteiro de
  duas mensagens no canal 5895 e impedir que essas peças antigas sejam enviadas.
- A auditoria de produção não encontrou linhas pendentes/pausadas com o texto
  exato da abertura antiga de duas mensagens no 5895; nenhuma fila foi cancelada.
- O deploy sozinho não reenfileira conversas históricas. A recuperação específica
  aprovada em 09/10 cobre quem teve a abertura antiga registrada nos últimos 72h;
  etapas novas já tentadas ficam preservadas e só as faltantes são retomadas.
- O identificador `mega-sorgo` fica reservado ao histórico legado. O canal 5895
  usa `mega-sorgo-5895-v2`, exibido como “Anúncios 5895 — 5 momentos”.
- Publicar o novo código no branch de produção e confirmar o build ativo.
  Nenhuma mensagem de teste será enviada a clientes.
