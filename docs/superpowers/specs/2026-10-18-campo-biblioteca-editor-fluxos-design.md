# Campo Soberano: biblioteca e editor visual de fluxos

**Data:** 2026-10-18
**Estado:** especificação pronta para revisão; implementação e deploy pendentes
**Origem funcional:** Faculdade CECAPE, `origin/main` em `e337af7`; mudanças de referência `0452d9e` (editor), `f070b61` (simulador), `e30b3b7` (biblioteca) e `937979c` (carregamento sob demanda).
**Destino:** repositório `evohub-bridge`, serviços `bridge/` e `web/` do Campo Soberano.

## Objetivo e limite da primeira entrega

Dar aos operadores do Campo Soberano um editor visual para os seis tipos de nó já reconhecidos pelo motor atual (`text`, `media`, `buttons`, `list`, `wait`, `end`), um simulador local e uma biblioteca de fluxos com rascunhos e versões publicadas imutáveis. A tela atual de JSON e os disparos existentes continuam disponíveis. Publicar um fluxo na biblioteca não inicia campanha nem altera uma campanha em andamento.

Esta entrega não copia funis, contatos, mensagens, marcas, credenciais ou registros da Faculdade CECAPE. Os nós avançados, campanhas por fluxo publicado, públicos salvos, relatórios e adaptação à CECAPE Dental serão projetos seguintes, cada um com integração e validação próprias.

## Decisão arquitetural

A migração será feita por módulo no repositório do Campo. O painel e o Bridge continuam serviços separados, apontando somente para o Supabase e os canais do Campo. O código da Faculdade é referência de comportamento, não uma branch a mesclar integralmente: os dois produtos têm regras comerciais e alterações locais divergentes. Após validar módulos semelhantes nos destinos, poderemos extrair um núcleo versionado compartilhado sem juntar bancos.

Antes de implementar, identificar o commit efetivamente implantado em `cofre.camposoberano.com.br` e `painel.camposoberano.com.br`. O checkout local do Campo tinha 78 entradas no `git status` no levantamento de 18/10; esse trabalho deve permanecer intacto. Criar uma área Git isolada a partir da base escolhida e integrar apenas as dependências necessárias ao módulo.

## Componentes e contratos

### Modelo e editor

- O objeto salvo é `Flow = { startId?: string, steps: FlowStep[] }`, compatível com `bridge/shared/flow.ts` do Campo. O canvas edita o mesmo grafo, sem criar um segundo formato de execução.
- O editor oferece os seis tipos de nó suportados nesta entrega, ligações `next`, `branches`, `fallbackNext` e `onTimeout`, escolha do nó inicial e modo JSON avançado. Não expõe nós que o Bridge do Campo ainda não executa.
- A validação visual alerta antes de salvar; a validação do Bridge é obrigatória ao publicar. Limites de botões/listas/texto devem seguir as regras do provedor implementadas no motor, sem divergência entre painel e servidor.
- `FlowSimulator` percorre o grafo no navegador, com respostas de exemplo e sem chamadas de envio, escrita de mensagens, alteração de estado de campanha ou consumo de canal.
- `FlowCanvas` e simulador são carregados sob demanda. `NEXT_PUBLIC_FLOW_EDITOR_V2` deve ter `ARG` e `ENV` no `web/Dockerfile`; no Campo o padrão inicial é desligado. Com a flag desligada, a tela legada de JSON permanece acessível.

### Biblioteca no Bridge

Criar `GET /flows` (lista não arquivada por padrão; `?include_archived=1` inclui arquivados), `GET /flows?id=<uuid>` (grafo editável e metadados), `GET /flows?id=<uuid>&version=<n>` (snapshot publicado) e `POST /flows` com ações `save`, `publish`, `archive` e `unarchive`. `save` exige nome não vazio e altera somente o grafo editável; se já houver versão publicada, o status continua `published`. Fluxo arquivado deve ser desarquivado antes de editar. `publish` valida o grafo, cria um snapshot que não será editado, calcula SHA-256 de uma serialização estável do JSON, avança `current_version` e define status `published`. `archive` define status `archived` e oculta da lista padrão, preservando histórico e versões; `unarchive` retorna a `published` se existir versão, caso contrário a `draft`.

Todas as operações exigem JWT válido do painel **e** autorização operacional equivalente a `public.can_read_operational_campaigns()` sob o JWT do usuário. O Bridge usa `service_role` somente após essa verificação. Falhas respondem `401` sem sessão, `403` sem permissão, `400` para grafo inválido, `404` para fluxo ausente, `409` para publicação concorrente e `500` para erro de persistência. Erro de rede ou servidor aparece no painel sem apagar o rascunho em edição.

O painel lê e grava a biblioteca apenas por essa rota autenticada. Não usa leitura direta de `flow_definitions`/`flow_versions` no navegador; isso evita a lista vazia causada por diferenças de RLS já observada na Faculdade.

### Banco do Campo

Adicionar migração própria, após as migrations atuais do Campo, criando `public.flow_definitions` e `public.flow_versions`. A primeira contém UUID, nome, descrição, status (`draft`/`published`/`archived`), JSON editável, ponteiro da versão publicada, autor e timestamps. A segunda contém UUID, referência ao fluxo, número da versão, JSON snapshot, checksum, autor e data de publicação, com unicidade `(flow_id, version)`. Habilitar RLS e conceder escrita somente a `service_role`; o painel não precisa de acesso direto às tabelas. Não haverá rota de atualização/exclusão de versões; uma proteção no banco rejeita `UPDATE`/`DELETE` de snapshots publicados.

A publicação deve ser atômica: validar o rascunho e sua revisão, bloquear a linha no banco, inserir a próxima versão e atualizar `current_version` na mesma transação. Se o rascunho mudou entre validação e publicação, devolver `409` e pedir nova revisão. A migração usa schema `public` explicitamente, como `0014_flow_state.sql` e `0016_rls_campaign_and_clientes.sql` do Campo. O handler acessa essas tabelas com `publicTable`, sem depender do valor de `SUPABASE_SCHEMA`, que no template do Campo aparece como `evohub`.

A migração cria tabelas novas; não modifica nem migra `campaign_flow_state`, `campaign_queue`, `contacts` ou mensagens. Cada banco permanece separado. Aplicar a migração somente após confirmar a identidade do Supabase do Campo e registrar o estado anterior do schema.

## Fluxo de uso

1. Operador autorizado abre `/fluxos` e cria ou carrega um rascunho.
2. Edita no canvas ou no JSON; o mesmo objeto `Flow` alimenta os dois modos.
3. Simula uma conversa localmente. Nenhum webhook ou mensagem é disparado.
4. Salva o rascunho pelo Bridge. Salvar não altera a versão publicada.
5. Publica quando a validação do Bridge passa. A biblioteca mostra `vN`; o snapshot `vN` permanece imutável após novas edições.
6. Campanhas atuais continuam lendo seu fluxo e estado como antes. A seleção de versões publicadas para campanhas pertence a uma entrega posterior.

## Falhas e segurança

- Nenhuma URL, chave, conta Chatwoot, instância Uazapi ou domínio da Faculdade entra no código/configuração do Campo.
- A rota não permite que um usuário autenticado sem autorização operacional leia ou grave a biblioteca.
- Em erro de banco, a versão publicada anterior continua apontada e o editor mantém o rascunho na tela.
- A migração e o novo código podem ser implantados com a flag visual desligada. Reverter a flag devolve a interface legada; as tabelas novas podem permanecer sem afetar campanhas antigas.
- Não executar testes de envio em números reais nessa primeira entrega. A validação do simulador é local e os testes de API usam dados de teste no banco do Campo.

## Critérios de aceite

1. O build do painel e a checagem do Bridge passam na base isolada do Campo.
2. Um usuário autorizado cria, salva, reabre, edita e publica um fluxo de seis tipos de nó; um usuário sem autorização recebe `403`.
3. Alterar o rascunho depois de publicar não altera o JSON da versão já publicada; uma nova publicação incrementa a versão.
4. O simulador percorre ramificações e pausas sem gerar mensagens, campanhas ou escritas operacionais.
5. Com a flag desligada, a tela legada e um disparo existente se comportam como antes. O Bridge antigo não depende das duas tabelas novas.
6. A migração é aplicada somente no banco do Campo, sem alterar dados da Faculdade ou da CECAPE Dental.

## Ordem de disponibilização

Preparar migração e código em área isolada; conferir identidade do banco e schema; aplicar a migração no ambiente de validação do Campo; implantar o Bridge; implantar o painel com editor desligado; validar API e simulador; ligar o editor para a validação operacional; então decidir a liberação geral. A produção requer uma revisão separada do diff, da migration e do plano de retorno antes de aplicar qualquer alteração externa.

## Etapas seguintes, fora deste desenho

Em especificações independentes: novos nós e efeitos de execução; campanhas de fluxo e públicos; relatórios e revisão diária; onboarding de canais; adaptação dos módulos validados ao repositório CECAPE Dental. Cada destino mantém seu próprio banco, migrations, credenciais, canais, identidade visual e regras comerciais.