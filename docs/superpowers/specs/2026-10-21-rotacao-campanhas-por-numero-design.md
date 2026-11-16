# Rotação diária das campanhas por número

## Objetivo

Enviar a reativação pelos números 5895, 0595 e 6836 entre 08h e 18h de Fortaleza. Cada número tem meta e teto de 25 contatos enviados no primeiro dia, acrescido de 5 por dia até 100. As campanhas `reativacao-5895-of` e `reativacao-5895-uz` compartilham o mesmo teto do 5895.

## Seleção e ritmo

As quatro campanhas formam três grupos pelo `channel_id`. A seleção consulta explicitamente cada fila, sem depender das primeiras 1.000 linhas do PostgREST. A cada oportunidade, prioriza o número com menor fração da meta cumprida, alternando empates em ordem estável; dentro do 5895, alterna as campanhas com pendências. Um único contato é processado por vez no conjunto. O espaçamento global é o tempo restante da janela dividido pelos envios ainda necessários: no início de um dia com três metas de 25, aproximadamente oito minutos entre números. Se um número ficar atrasado, o intervalo se ajusta ao tempo restante, limitado a um minuto entre tentativas. O cálculo considera somente envios confirmados pela fila; contatos pulados não consomem a meta. A janela e o teto são barreiras rígidas; problemas do provedor podem impedir atingir a meta.

## Segurança operacional

Uma reserva transacional impede processamentos simultâneos das quatro campanhas, inclusive com mais de uma réplica. A validação de contato, atendimento ativo, etiqueta comercial, bot silenciado, pausa por resultado incerto e limite de tentativas seguem ativos. Se não houver candidatos elegíveis, a fila permanece pendente e um diagnóstico deve mostrar a causa.

## Verificação

Testar a seleção além de 1.000 linhas, o teto combinado do 5895, o intervalo de oito minutos no início do dia, recuperação proporcional após atraso, impedimento de dois envios simultâneos e janela 08h–18h. Após publicar, conferir o commit do Coolify, a saúde da ponte e os contadores das três filas.
