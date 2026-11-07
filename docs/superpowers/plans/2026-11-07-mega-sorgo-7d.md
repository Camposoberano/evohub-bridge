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

- Catálogo próprio de 39 peças e cinco vídeos condicionais preparado; os 27 slots de mídia foram cadastrados em `soberano-out/funil/mega-sorgo-7d-v1/` e as URLs responderam HTTP 200. Os dez áudios foram aceitos pelo dono como gravados; a peça 25 usa cópia cortada antes do trecho final incompleto.
- Agenda de sete dias, pausa por resposta, opt-out, retomada manual, allowlist de conversa e fila n8n estão implementados localmente. Testes focados: 22 passaram; `deno check server.ts` passou.
- Workflow separado `tqo0h3yNVAykSZdK` (`Soberano — Mega Sorgo 7 dias TESTE`) criado no projeto pessoal do Cícero e mantido **inativo**. A credencial de entrada foi atribuída. O conector n8n recusou atribuir a credencial Bearer existente `Soberano 5895 bridge enqueue` ao nó HTTP Request; a ligação precisa ser concluída antes de qualquer ensaio real. O editor local estava desabilitado no ambiente Codex.
- O bridge ainda não foi publicado nem implantado, e a variável `MEGA_SORGO_7D_TEST_CONVERSATIONS` continua vazia: nenhum lead real pode entrar na versão nova. A versão dos anúncios 5895/6836 continua a atual.
- Para considerar pronto para troca: resolver credencial n8n; fazer ensaio ponta a ponta em uma conversa de teste de cada número; verificar recibos e ausência de duplicidade; preparar a reversão. Ainda não marcar estes itens como concluídos.
