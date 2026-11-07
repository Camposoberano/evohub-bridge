# Mega Sorgo 7 dias — plano de implementação

> Execução local na branch `codex/mega-sorgo-7d`; sem mudar o roteamento dos anúncios.

**Objetivo:** deixar a versão `mega-sorgo-7d-v1` pronta para teste isolado nos canais 5895 e 6836.

**Arquitetura:** conteúdo, agenda e mídia próprios; fila e claims existentes; novo contrato n8n; estado sempre por conversa. A seleção da versão nova só ocorre por comando explícito de teste antes da virada.

**Stack:** Deno, Supabase self-host, n8n, Chatwoot, uazapi.

**Spec:** `docs/superpowers/specs/2026-11-07-mega-sorgo-7d-design.md`.

## Restrições globais

- Não trocar a versão dos novos anúncios 5895/6836 nesta etapa.
- Não sobrescrever mídias da versão atual.
- Cinco vídeos oficiais só depois de aceite; o primeiro é `VIDEO 01 INICIO 1X1.mp4`.
- Pausa por atendimento humano não retoma sozinha.
- Não implantar/reiniciar bridge entre 08h–20h BRT sem OK explícito.

## 1. Conteúdo e catálogo

**Arquivos:** criar `bridge/shared/mega-sorgo-7d-content.ts`, `bridge/tests/mega-sorgo-7d-content.test.ts`; adaptar `bridge/handlers/n8n-action-enqueue.ts`.

- [ ] Converter as peças 01–31 do documento 21, respostas de botão e dias 5–7 em manifesto tipado com códigos estáveis, tipo, texto, botões, mídia e ordem.
- [ ] Criar uma verificação que falhe se faltar peça, texto, botão ou referência de mídia e que rejeite claims antigos (`140 t/ano`, `quase imune`, `80% superior`).
- [ ] Cadastrar mídia da nova versão em caminhos separados e conferir HEAD/Content-Type de todas as URLs; documentar hash local, tamanho e URL sem segredo.
- [ ] Comparar os dez áudios gerados aos roteiros do documento 21; recortar o final de `01_fase_05` e verificar por audição antes do cadastro.

## 2. Agenda

**Arquivos:** criar `bridge/shared/mega-sorgo-7d-schedule.ts`, `bridge/tests/mega-sorgo-7d-schedule.test.ts`; adaptar o contrato do `n8n-action-enqueue`.

- [ ] Calcular dias 1,2,3,5,6,7 em America/Fortaleza, com intervalos entre peças e janela 08h–20h; dia 4 vazio.
- [ ] Calcular cinco dias úteis de validade da condição separadamente da agenda; validar entrada na sexta, fim de semana e feriados se a regra comercial fornecer calendário.
- [ ] Enfileirar o manifesto em `scheduled_messages` e `sales_sequences` com `funnel=mega-sorgo-7d-v1`, IDs determinísticos por conversa/peça e nenhuma inscrição duplicada.
- [ ] Manter seleção de teste explícita; auto inscrição e anúncios continuam na versão atual.

## 3. Travas e entrega

**Arquivos:** criar `bridge/shared/mega-sorgo-7d-state.ts`, `bridge/tests/mega-sorgo-7d-state.test.ts`; adaptar `bridge/shared/funnel-state.ts`, `bridge/handlers/n8n-queue.ts`, `bridge/shared/funnel-queue.ts` e handlers de entrada/controle conforme o caminho real.

- [ ] Pausar fila da conversa em texto livre, áudio, foto, preço, vídeo, compra, CEP/CPF, reclamação e tomada humana; clique de botão trata o ramo sem pausa genérica.
- [ ] Implementar opt-out, compra e retomada explícita, preservando o ponto restante e sem timer automático.
- [ ] Antecipação de vídeo/preço marca equivalentes após recibo confirmado; recibo incerto bloqueia repetição até reconciliação.
- [ ] Revalidar estado e claim antes do envio; limitar uma peça em trânsito por conversa e respeitar interação recente e janela.

## 4. n8n e ensaio

**Artefatos:** workflows novos de versão de teste, inativos para tráfego comum, e roteiro em `docs/`.

- [ ] Inventariar os workflows ativos que fazem inscrição, preço, vídeo, botão, pausa e pump; usar o SDK do conector n8n para criar somente os necessários para `mega-sorgo-7d-v1`.
- [ ] Validar payloads do novo contrato e os workflows antes de salvar; não alterar os 14 workflows ativos do 5895.
- [ ] Testar unidade, integração local, checagem Deno e ensaio acelerado em conversa de teste dos dois números, sem anúncio real.
- [ ] Preparar checklist de virada e reversão; confirmar que a versão nova está completa e que o roteamento de produção continua na antiga.

## Estado em 07/11/2026

- Catálogo próprio de 39 peças e cinco vídeos condicionais preparado; os 27 slots de mídia foram cadastrados em `soberano-out/funil/mega-sorgo-7d-v1/` e todas as URLs responderam HTTP 200 com `Content-Type` compatível. Os dez áudios foram aceitos pelo dono como gravados; a peça 25 usa cópia cortada antes do trecho final incompleto. Os canais reais consultados no banco são WhatsApp com nomes e finais 5895 e 6836, compatíveis com o bloqueio da versão de teste.
- Agenda de sete dias, pausa por resposta, opt-out, retomada manual, allowlist de conversa e fila n8n estão implementados localmente. Testes focados: 22 passaram; `deno check server.ts` passou.
- Workflow separado `tqo0h3yNVAykSZdK` (`Soberano — Mega Sorgo 7 dias TESTE`) criado no projeto pessoal do Cícero e mantido **inativo**. As credenciais existentes de entrada e saída foram associadas. O conector n8n recusou associar a credencial Bearer ao nó HTTP Request; a API oficial do n8n confirmou a associação depois, sem criar segredo novo. O nó de validação gera `request_id` estável por conversa, exigido pelo contrato do bridge; esta correção foi conferida na versão salva do workflow.
- O bridge ainda não foi publicado nem implantado, e a variável `MEGA_SORGO_7D_TEST_CONVERSATIONS` continua vazia: nenhum lead real pode entrar na versão nova. A versão dos anúncios 5895/6836 continua a atual.
- Para considerar pronto para troca: fazer ensaio ponta a ponta em uma conversa de teste de cada número; verificar recibos e ausência de duplicidade; preparar a reversão. Ainda não marcar estes itens como concluídos.

O dono informou o número próprio `11910363320` para o ensaio. As conversas existentes são Chatwoot **673 no 5895** e **1286 no 6836**; não há sequência ativa/pausada de outra versão nessas conversas. A cadência de teste foi comprimida para uma peça a cada **5 minutos**, preservando a janela de envio 08h–20h BRT. Se as 39 peças não couberem até 20h, as restantes passam para 08h do dia seguinte. Esta compressão só é usada pela versão isolada de teste; a agenda nominal de sete dias permanece disponível para a virada futura.

## Ensaio controlado e reversão

1. Publicar o código da branch no `main` e implantar o bridge em janela permitida. Conferir `uptime_s` de `/version` e a saúde do bridge. A variável `MEGA_SORGO_7D_TEST_CONVERSATIONS` deve conter **somente** os IDs Chatwoot de teste fornecidos pelo dono, um do 5895 e um do 6836.
2. Conferir no n8n o workflow `tqo0h3yNVAykSZdK`: autenticação de entrada `httpHeaderAuth`, saída `httpBearerAuth`, caminho `soberano-mega-sorgo-7d-teste`. Publicá-lo somente para o ensaio; ele não recebe tráfego dos anúncios.
3. Em cada conversa de teste, verificar que não há `sales_sequences` ativa/pausada de outra versão. Enviar uma única requisição autenticada `action=funil`, `source=macro`, `funnel_version=mega-sorgo-7d-v1`. Confirmar 39 linhas agendadas, uma sequência `running`, horários locais e nenhuma linha do dia 4. Repetir a mesma requisição para confirmar idempotência.
4. Conferir envio e recibo de uma peça texto e uma mídia em cada número; responder texto livre e confirmar pausa das peças restantes. Retomar explicitamente e confirmar reancoragem. Em teste separado, tocar `video_7d_sim` e verificar cinco vídeos em ordem, sem repetição. Verificar opt-out e atendimento humano em conversas descartáveis.
5. Se houver erro, despublicar o workflow de teste, esvaziar a allowlist e pausar as sequências `mega-sorgo-7d-v1` ainda pendentes. Os roteadores de anúncios continuam apontados para `mega-sorgo-5895-20260930`; não alterar `channels.status` e não pausar a versão atual.

## Virada futura dos anúncios

A virada exige patch próprio após o ensaio: trocar o seletor de versão em `funnel-identity.ts`, ajustar inscrição e catch-up em `funil-enroll.ts`, apontar o acionamento n8n dos anúncios ao contrato novo, revisar controles e relatórios que consultam a versão antiga, e definir destino das sequências antigas ainda ativas. Fazer deploy e verificar ambos os canais; manter caminho para voltar o seletor antigo sem apagar histórico. Este patch não faz parte da preparação isolada.

## Ensaio em andamento — 07/11/2026

- Código publicado no `main` em `5f88cc8`, Coolify produção `m8qf6ru2x75gukzozpsrssrm` implantado; `/version` confirmou `2026-11-07-mega-sorgo-7d-test`. Allowlist de produção: conversas 673 e 1286. Workflow n8n `tqo0h3yNVAykSZdK` publicado somente para teste.
- Inscritas 39 peças em cada conversa para o número próprio `11910363320`. Texto, imagem e cartão interativo saíram em ambos; replay da inscrição 673 retornou `duplicate=true`, preservando 39 linhas.
- No 5895 o clique “Quero saber mais ✅” chegou como `[button]` e texto espelhado sem ID, causando pausa antes do áudio. Hotfix `cabcf95` reconhece títulos exatos dos botões informativos e `[button]`; teste unitário e `deno check` passaram. Coolify implantou o hotfix e `/version` confirmou `2026-11-07-mega-sorgo-7d-button-echo`. A sequência 673 foi retomada com 36 peças reancoradas, começando às 17h36 BRT. O 6836 seguiu em `running` e dois áudios já saíram.
- Os primeiros vídeos dos dois canais ficaram `sent` com mídia e ID Chatwoot; o dono confirmou que o vídeo do 6836 chegou e abriu no WhatsApp. Aguardar confirmação visual do 5895. Acompanhar os cinco vídeos oficiais condicionados ao botão “Sim, quero ver”. Não trocar o roteamento de anúncios enquanto o ensaio estiver em andamento.

### Correção de vídeos sem som, 19h BRT

- O dono informou que os vídeos recebidos estavam sem som. `ffprobe` mostrou que os cinco ganchos originais de 12–13 s tinham somente `h264` e **nenhuma faixa de áudio**; as cópias comprimidas preservaram essa ausência. Os cinco vídeos oficiais tinham `h264+aac` e não foram alterados.
- As conversas 673 e 1286 foram pausadas antes dos próximos ganchos: 0 `pending` em cada uma. O dono escolheu usar a voz já gravada do Cícero. Foram montadas cinco cópias narradas (`p06`, `p11`, `p16`, `p22`, `p24v`) com áudio AAC; `ffprobe` e medição de volume confirmaram faixa audível, de 0,94 a 1,65 MB por MP4.
- As cinco cópias foram cadastradas em `soberano-out/funil/mega-sorgo-7d-v1/narrado-20261107/`, com HEAD 200. `funnel_media` foi atualizado apenas nos cinco slots da versão 7d, e as quatro peças futuras pausadas (`p22`, `p24v` em cada conversa) receberam a nova URL. O catálogo local também referencia as cópias narradas para cadastros futuros.
- Um clipe narrado foi enviado fora da fila para o número de teste em cada canal; ambos foram registrados `sent`. **Aguardar confirmação do dono de que chegaram com som antes de retomar as sequências.** Vídeos mudos já enviados no ensaio não podem ser corrigidos retroativamente; as cópias narradas evitam novos envios mudos.
