# Reparos do Mega Sorgo 7 dias — desenho para validação

## Objetivo e limite

Corrigir falhas comprovadas no ensaio de 08/11 sem encurtar a apresentação. O catálogo mantém **34 peças**, os **10 áudios aprovados**, a abertura com áudio antes do texto, o dia 4 sem mensagens e os cinco vídeos oficiais somente após “Sim, quero ver”. Os anúncios do 5895 e 6836 continuam no funil atual. Esta entrega prepara a versão isolada para um agente testar; não troca o roteamento nem inscreve clientes reais.

## Conteúdo

1. Retirar o marcador literal `[nome]` das peças `d6_duvida` e `d7_ultima`. Usar frases naturais sem depender de nome cadastrado; o texto enviado deve coincidir com o catálogo.
2. Manter a posição `d5_pdf` no dia 5 para preservar as 34 peças, mas transformá-la em um lembrete curto de que o material da Embrapa está disponível por pedido. O arquivo PDF sai apenas pelo fluxo já existente do botão `menu_isca_silagem`; o lembrete não anexa o PDF. Repetir o clique não pode gerar PDFs duplicados.
3. Preservar os demais textos, dez áudios, imagens e botões nesta rodada. Não alterar percentuais, disponibilidade ou promessa comercial automaticamente; conferir sua fonte antes de uma futura virada de anúncios.

## Agenda e gatilhos

O contrato da versão 7d distingue explicitamente **ensaio acelerado** de **agenda real**. A agenda real usa `scheduleSevenDayPieces`: dias 1, 2, 3, 5, 6 e 7, janela de 08h–20h em Fortaleza e espaçamento dentro do dia. O ensaio acelerado usa `scheduleSevenDayTestPieces` somente quando um pedido de teste autenticado marcar esse modo e a conversa estiver na allowlist. O modo padrão nunca deve comprimir sete dias em menos de três horas. A versão continua bloqueada para anúncios até uma virada posterior específica. A exceção noturna de 08/11, já expirada, é removida do bridge e do cron n8n para não deixar código temporário no caminho permanente.

Os cinco vídeos oficiais continuam fora das 34 peças. Sem clique em `video_7d_sim`, não há linhas `mega-sorgo-7d-v1:video`; com um clique, entram cinco vídeos em ordem, uma vez por conversa. Repetição do mesmo clique não duplica a fila. Uma resposta livre ou pedido comercial pausa a cadência conforme a regra atual.

## Verificação para o agente

- Testes locais validam 34 peças, dez áudios, áudio inicial, ausência de `[nome]`, PDF não anexado automaticamente e nenhuma mídia de vídeo antes do aceite.
- Testes de agenda verificam seis dias ativos, dia 4 vazio, horários de Fortaleza, virada de dia e separação explícita entre modo real e acelerado.
- Testes do botão verificam zero vídeos sem clique, cinco em ordem após o primeiro clique, nenhum novo após o segundo e URLs acessíveis.
- Um roteiro operacional usa conversas de teste novas ou limpas, confirma recibos por `scheduled_message_id` e distingue `sent` no bridge de entregue/lido no aparelho. Confere que uma peça `text_sequence` pode gerar mais de uma mensagem sem ser duplicação.
- A verificação final confirma que o funil dos anúncios 5895/6836, os outros canais e campanhas permanecem como estavam. Nenhum deploy nem disparo a clientes reais faz parte desta etapa.
