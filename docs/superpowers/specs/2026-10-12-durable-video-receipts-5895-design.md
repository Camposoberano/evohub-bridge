# Recibos duráveis e alertas dos vídeos do funil 5895

## Objetivo

Impedir que uma atualização de entrega da Uazapi se perca no webhook e reduzir o tempo entre um recibo confirmado e a liberação da próxima peça do funil `mega-sorgo-5895-20260930`. Exibir vídeos sem confirmação no painel e acompanhar a mudança em produção sem disparos de teste ou reenvios incertos.

## Contexto confirmado

O envio assíncrono já usa um `track_id` por tentativa e exige um único status `Delivered`, `Read` ou `Played`. A reconciliação atual consulta `/message/find` a cada minuto e só marca `sent` com prova única. Em 12/10, houve vídeos que permaneceram em `Sent`; as peças seguintes ficaram bloqueadas corretamente. O webhook atual devolve `200` antes de confirmar a gravação do evento e ignora erro nessa gravação.

## Abordagens consideradas

1. **Reenvio automático após alguns minutos:** recuperaria alguns casos, mas pode duplicar vídeos aceitos pelo provedor. Rejeitada.
2. **Apenas aumentar a frequência da consulta:** reduz parte da espera, mas não resolve perda de webhook nem mostra claramente os casos sem recibo. Rejeitada.
3. **Recibo persistido, reconciliação dirigida e alerta:** mantém a confirmação estrita e torna o bloqueio visível. Escolhida.

## Desenho aprovado

1. O webhook autenticado persiste o evento redigido antes de responder `200`. Falha de persistência responde erro temporário para permitir nova tentativa da Uazapi. A ingestão de mensagens segue idempotente. O evento não expõe token, telefone, conteúdo ou URL no diagnóstico operacional.
2. Quando chegar `messages_update` ou `ReadReceipt` com status confirmado, o bridge tenta correlacionar `track_id` ou ID do provedor com uma tentativa incerta do vídeo 5895. A confirmação usa os mesmos critérios estritos da reconciliação existente, com consulta ao histórico do provedor. Resultado ausente ou ambíguo preserva `failed/uncertain`. O cron de um minuto continua como recuperação.
3. Após cinco minutos sem confirmação, o painel do funil mostra a idade da tentativa, status pendente, conversa e etapa, com link de conferência. O monitor operacional cria um alerta específico com contagem, sem dados pessoais. Nenhum botão de reprocessar aparece para um envio incerto.
4. A publicação é seguida por observação dos envios reais: contagem de vídeos devidos, confirmados, ainda em `Sent`, reconciliados via webhook e via cron, atraso até a confirmação, cópias e bloqueios. Nenhuma mensagem de teste ou repetição incerta será feita. Um status `Sent` não será relatado como entrega ao aparelho.

## Limites

Esta correção não transforma um `Sent` em `Delivered` quando o provedor não emite recibo. Esses casos permanecem para conferência humana. O escopo de confirmação imediata é apenas o vídeo agendado do funil 5895; o webhook durável beneficia os demais eventos sem mudar suas regras de disparo.
