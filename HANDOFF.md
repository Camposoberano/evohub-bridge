# HANDOFF — Soberano (EVO Hub + Chatwoot + Bridge + Dashboard)

> Documento de estado do projeto. Lê isto antes de mexer em qualquer coisa.
> Última atualização: 2026-07-09 14:00

## 🔁 SESSÃO ATUAL — 2026-07-09
- Revisão do painel/dashboard e da arquitetura do projeto concluída.
- Verificado o uso de `cofre.camposoberano.com.br` e `cofre.2.camposoberano.com.br` no frontend e nos scripts.
- Confirmado que a ponte Deno, o Chatwoot, o Supabase e os endpoints uazapi/ryzeapi estão integrados pela mesma base de código.
- Nenhuma correção de código aplicada nesta sessão; foco em alinhamento e validação de funções existentes.

## 🔴 PRÓXIMO PASSO: Recriar caixa 5895 do zero

Usuário vai pausar e depois voltar. **Tarefa principal**: apagar e recriar a inbox do 5895 no Chatwoot.

## 📋 Resumo da sessão (08/07/2026)

### Problemas encontrados e resolvidos
1. **Webhook global EVO Hub desabilitado** → recriado 3x, sempre auto-desabilitado pelo EVO Hub (falhas de entrega)
2. **Chatwoot com 500 Internal Server Error** → VPS sobrecarregada (13.3/15.6 GiB RAM, 11.8% CPU steal)
3. **Sidekiq a 73.7% CPU** → inboxes `[DESATIVADA] WA uazapi 5895` (id 43) e `[DESATIVADA] WA uazapi 11910363320` (id 44) com webhooks quebrados (404) em retry loop → **deletadas**
4. **PostgreSQL healthcheck quebrado** (`-U ${POSTGRES_USER}` resolvido vazio) → corrigido no docker-compose do Chatwoot para `-U $${POSTGRES_USER}` (escapado)

### Estado atual
- **Bridge**: online, build `2026-07-06-anti-dup`, zero erros
- **Chatwoot**: voltou, sem 500, inboxes quebradas deletadas
- **Webhook 5895**: `e0b6a12d` (active, sem channel_ids — EVO Hub ignora)
- **5895**: mensagens chegam no WhatsApp mas não aparecem no Chatwoot
- **VPS**: ainda no limite (12 serviços em ~16 GB RAM)
- **Sessão 2026-07-09**: verificação do painel e alinhamento de arquitetura concluída; validado que `cofre`/`cofre.2` e `Supabase`/`Chatwoot` entram na mesma infraestrutura.

## 📦 CONFIGS DO 5895 (backup pra recriação)

### Canal no Supabase
```
id: 3516c0a2-9519-4b57-9d32-ad342f6f8242
type: whatsapp
name: "5895"
status: active
hub_channel_id: 3cd9df61-a599-4c32-8da8-b3e683550284
phone_number_id: 956105997592428
waba_id: 743886211614541
phone_number: +55 19 99971-5895
display_name: Campo Soberano
chatwoot_inbox_id: 34
chatwoot_inbox_identifier: gYUdPdQfV4CfnKs7rJYM72Ki
channel_token: b8c03c37e37c5b18d123e815361a2dc5a0fd77f8bfbd51b0bba09cc61028de6d
```

### Canal no EVO Hub
```
id: 3cd9df61-a599-4c32-8da8-b3e683550284
waba_id: 743886211614541
business_id: 699887902753241
phone_number_id: 956105997592428
status: CONNECTED, qualidade GREEN
```

### Inbox no Chatwoot
```
Conta 1
id: 34
name: WA Oficial 5895
inbox_identifier: gYUdPdQfV4CfnKs7rJYM72Ki
channel_type: Channel::Api
```

### Webhook ativo (dedicado)
```
id: e0b6a12d-f41f-474f-9b8d-457e226f67cf
name: webhook 5895
url: https://cofre.camposoberano.com.br/hub-webhook
status: active
events: messages, message_echoes, smb_message_echoes, message_deliveries, message_reads
all_channels: false
```

### Etiquetas (labels) do Chatwoot
```
1  | testando-agente     | #6BBF8A | Habilita agente IA em modo teste
2  | agente-off          | #E8735A | Desabilita agente IA
16 | janela-aberta       | #2ECC71 | Janela Meta aberta
17 | janela-fechando     | #F39C12 | Janela Meta fechando <2h
18 | janela-fechada      | #E74C3C | Janela Meta fechada
19 | canal-oficial       | #3498DB | Canal WhatsApp oficial
20 | canal-nao-oficial   | #9B59B6 | Canal WhatsApp não-oficial
21 | origem-anuncio      | #1ABC9C | Lead veio de anúncio (CTWA) - janela 72h
22 | cmd-funil-pause     | #f59e0b | Comando funil
23 | cmd-funil-stop      | #ef4444 | Comando funil
24 | cmd-funil-resume    | #22c55e | Comando funil
25 | cmd-enviar-preco    | #f97316 | Disparo
26 | cmd-enviar-video    | #8b5cf6 | Disparo
27 | cmd-enviar-plantio  | #22c55e | Disparo
28 | cmd-enviar-nutricao | #06b6d4 | Disparo
29 | cmd-iniciar-funil   | #3b82f6 | Iniciar funil
```

### Sistema Híbrido (auto-discovery uazapi)
- Feature flag: `hybrid-routes-uazapi` (ativa no build)
- Endpoint: `GET /hybrid-routes` (auth: token ou JWT)
- Lógica: cruza `phone_number` do canal oficial com instâncias uazapi `connected`
- Templates (`/template`) → SEMPRE oficial
- Texto/mídia → uazapi primeiro, fallback oficial se falhar
- Cache: 60s
- Janela Meta ignorada quando há rota híbrida

## 🚀 Deploy
- `git push origin master:main` (Coolify observa `main`)
- Bridge: Coolify UUID `g5oxpau2ffnvso50m3wuhwxq`
- Painel: Coolify UUID `wwkt5an839c410ceklpu1cns`
- Force deploy without cache quando mexer no Dockerfile

## ⚠️ VPS - Alerta
- 13 serviços na mesma máquina (localhost Coolify)
- RAM: 13.3/15.6 GiB (85%)
- CPU steal: 11.8% (overselling do provedor)
- Chatwoot `unhealthy` (healthcheck postgres corrigido, precisa redeploy)
- Servidor já ficou inacessível 6x

## 🔴 ALERTA: Sessão anterior "ORACLE" (07/07) foi PERDIDA
Os debug-logs do VS Code sumiram entre reinicializações. Nenhum turn foi preservado.
**Regra nova no CLAUDE.md global: sempre perguntar "quer salvar handoff?" antes de encerrar.**

## 1. O que é o projeto

SaaS omnichannel de WhatsApp/Facebook/Instagram. Peças:

- **EVO Hub** (`api.evohub.ai`) — gateway pra Meta (WhatsApp oficial, Facebook, Instagram). Modo **shared** (o app da Meta é do EVO Hub). Proxy `/meta/*` (Bearer = `channel_token`, **sem versão no path**). Encaminha webhooks pra vários destinos.
- **Bridge** (Deno) — `https://cofre.camposoberano.com.br`. Traduz Meta ↔ Chatwoot, persiste tudo no Supabase (analytics), motor de campanha, transcode de áudio, etc. **É o cérebro.**
- **Chatwoot** (`gerenciador.soberano.pro`, stack fazer.ai) — onde o atendente conversa. Contas: **2 = "Campo Soberano"** (principal), **1 = "Chatwoot 1"** (mesma instância, mesmo token).
- **Dashboard Next.js** (`web/`) — telas: central/conexões, conversas, contatos, analytics, disparos, campanhas, instâncias, etc.
- **Supabase self-host** — `bancortovital.soberano.pro`. Guarda canais, contatos, conversas, mensagens, eventos, métricas. Buckets de Storage (ver §7).
- **uazapi** (`camposoberano.uazapi.com`) — WhatsApp **não-oficial** (disparo em massa + Chatwoot nativo). Reserva/uso paralelo.

### Fluxo (oficial)
`Meta → EVO Hub (webhook) → bridge /hub-webhook → Chatwoot (inbox API) + Supabase`
`Atendente no Chatwoot → /chatwoot-webhook → bridge → /meta/* → Meta`

## 2. FEITO e funcionando ✅

- **WhatsApp oficial bidirecional** (texto, imagem, vídeo, áudio, documento) — entrada e saída.
- **Áudio do chat → voz/PTT** (ogg/opus via ffmpeg, hospedado no bucket `soberano-out`).
- **Mídia com legenda** não some (bug antigo: `if(content)` mandava só texto).
- **Echo do aparelho** (coexistência app+API): mensagem mandada pelo celular do número oficial aparece no chat (`message_echoes`).
- **Facebook** bidirecional (texto + mídia); mensagem mandada pela página/app aparece no chat (via sync, ~30s).
- **"Failed to send" cosmético** resolvido — webhook responde 200 na hora, envia em background.
- **Template gated (campanha)** — tela **Campanhas**: template oficial → cliente responde (abre janela 24h) → dispara sequência. 1 webhook só.
- **Template com header de mídia** (imagem/vídeo/doc) — a tela pede a URL quando o template tem header.
- **Template de dentro do chat** — atendente digita `/template <nome> [idioma]` numa conversa.
- **Multi-conta Chatwoot** — conta 1 e 2 na mesma instância (mesmo token); cada tela cria canal na conta certa.
- **Analytics** — tudo persiste no Supabase (mensagens in/out, contatos, eventos).
- **uazapi** — instâncias, disparo em massa, Chatwoot nativo, atribuição instância→tela.
- **Atendimento consolidado na inbox API do bridge** (inbox 22 pro número oficial).

## 3. NÃO feito / pendente ⏳

- 🔒 **Revogar os 3 tokens** do Meta System User que foram colados no chat (EXPOSTOS). Meta Business → Usuários do sistema → revoga → gera novo → cola só no `.env`/Chatwoot. **Ação do usuário.**
- **Apagar a caixa nativa (inbox 21)** no Chatwoot, se ainda existir (foi um teste abandonado).
- **Display multi-conta no central**: canal oficial criado na conta 1 **funciona** (entra/sai), mas no painel aparece listado só na conta principal — o frontend ainda não sabe a conta por canal. Cosmético.
- **Facebook echo = ~30s** (vem pelo sync, não instantâneo). Pra instantâneo, precisaria tratar `is_echo` no webhook de `object=page`.
- **Template com variáveis** (`{{1}}`) — hoje só template sem variável (`components: []`). Falta UI/parse de variáveis.
- **Áudio PTT depende do Chatwoot servir mp3** — se o Chatwoot mudar o formato de gravação, revisar `toVoiceOgg`.

## 4. Deu ERRADO → corrigido (causa raiz) 🛠️

| Problema | Causa raiz | Correção |
|---|---|---|
| **Deploy não atualizava** (horas perdidas) | Coolify deploya branch **`main`**; eu commitava em **`master`** | Sempre `git push origin master:main` |
| **Áudio não virava PTT** (`exit 127`) | Imagem `deno:alpine` traz `/usr/local/lib/libgcc_s.so.1` incompatível que **sombreia** o da alpine | `env LD_LIBRARY_PATH=/usr/lib:/lib` no spawn do ffmpeg + `--allow-run` sem escopo |
| **"Failed to send" / 401** (inbox nova) | Inbox API recriada **sem `?token=`** na webhook_url | PATCH da inbox com `?token=<CHATWOOT_WEBHOOK_SECRET>` |
| **"Failed to send" em mídia** | Webhook demorava (envio antes de responder) → Chatwoot marca falha por timeout | Responde 200 na hora, envia em background |
| **Template não saía** (`131042`) | **Billing da WABA** sem forma de pagamento | Usuário configurou pagamento no WhatsApp Manager |
| **Mídia com legenda sumia** | `if(content) só texto; else mídia` | Mídia tem prioridade; legenda entra na mídia |
| **Áudio do aparelho duplicava/loop** | Echo injetado como outgoing → Chatwoot reenviava | Anti-loop: não reenvia msg já no banco (`chatwoot_message_id`) |
| **Mensagem do aparelho não chegava** (WhatsApp) | `message_echoes` ignorado | hub-webhook ingere echo como saída |
| **Mensagem da página não chegava** (Facebook) | sync pulava `senderId === page` (skipped_self) | Ingere como saída na conversa do destinatário |
| **Chatwoot S3 quebrava boot** | valor errado de `ACTIVE_STORAGE_SERVICE` | correto = **`s3_compatible`** (do storage.yml) |

## 5. O que NÃO PODE fazer (limitações) 🚫

- **Caixa nativa do Chatwoot WhatsApp Cloud não serve** pro número oficial: ela manda direto pra Meta, **pulando o bridge** → perde PTT/mídia-legenda/echo/analytics. E como o número está em modo **shared** no EVO Hub, você **não controla o webhook do app da Meta** (não é dono do app) → a nativa nem receberia entrada sem repasse. **Decisão: atendimento sempre na inbox API do bridge.**
- **Template fora da janela 24h** exige template aprovado **+ billing da WABA ativo**. Texto livre fora da janela é bloqueado pela Meta (não é bug).
- **DDL no Supabase bloqueado** (sem `SUPABASE_DB_URL`) → config nova vai em **Storage JSON** (`soberano-config`), não em tabela nova.
- **Não colar segredo no chat** — vai pro `.env`/Coolify/Chatwoot.
- **Mesmo número não pode ser oficial + não-oficial** ao mesmo tempo.

## 6. Deploy 🚀

- Bridge: Coolify deploya `Camposoberano/evohub-bridge:**main**`. Trabalho local em `master`.
  **Sempre:** `git push origin master:main` → no Coolify **Force deploy (without cache)** quando mexer no Dockerfile.
- Confere subiu: `GET https://cofre.camposoberano.com.br/version` → campo `build`.
- Existem 2 apps de bridge no Coolify; só um serve o domínio. Cuidado pra não deployar o errado.
- Build atual: ver `bridge/server.ts` campo `build`.

## 7. Config / IDs (não-secreto) 📌

- **WhatsApp oficial:** número `5511910363320`, phone_number_id `101473206115219`, WABA `108121798773503`, Meta App (BYO "campo soberano") `1594384417385131`. Inbox Chatwoot **22**.
- **Facebook:** page_id `112114627195174`, canal `d8463303-...` (Atendimento FB).
- **EVO Hub canal (oficial):** `c3b95d14-7c25-4be4-8a86-aed40fb22bc6` (shared).
- **Chatwoot:** `gerenciador.soberano.pro`, contas 1 e 2.
- **Buckets Supabase Storage:**
  - `soberano-config` — JSON de config (campaigns.json, native-inboxes.json, channel-accounts.json, instance-telas.json).
  - `soberano-out` — **público**; áudio ogg/PTT gerado pelo bridge.
  - `chatwoot-media` — anexos do Chatwoot (Active Storage, `s3_compatible`).
- **Segredos (no `.env`/Coolify):** `META_ACCESS_TOKEN`, `EVOLUTION_HUB_API_KEY`, `CHATWOOT_API_ACCESS_TOKEN`, `CHATWOOT_ADMIN_TOKEN`, `CHATWOOT_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

## 8. Próximos passos / oportunidades 💡

- **Template com variáveis** (`{{1}}`, `{{2}}`) na tela Campanhas + no `/template`.
- **Agendar campanha** (data/hora) — ex.: "Sul em setembro, Nordeste não". uazapi já tem `scheduled_for`; pro oficial, montar agendador no bridge.
- **Display multi-conta correto** no central (saber a conta por canal — guardar em `channel-accounts.json` e o frontend ler).
- **Facebook echo instantâneo** (webhook `object=page` com `is_echo`) em vez do sync de 30s.
- **Automatizar "criar caixa por número oficial"** no connect-channel (hoje a inbox é criada, mas o padrão multi-conta é manual).
- **Instagram** — entrada só via sync (a Meta não manda webhook de msg pro IG). Validar fim-a-fim.
- **Hardening**: retries de webhook, painel de erros de entrega, RLS, monitoramento.
- **Analytics comercial** (ganho/perdido, valor, origem) — schema existe, falta preencher/telas.

---
**Regra de ouro:** o bridge é o caminho de tudo. Não tente "atalhar" pela Meta direto (caixa nativa) — você perde o processamento. E todo deploy vai pra `main`.

---

## Campanha Sul Grupo A / 5895 - 24/08/2026

- Relatorio completo: `docs/relatorio-campanha-sul-grupo-a-5895-2026-08-24.md`.
- Fila da campanha `camp_20260818023357`: 273 enviados, 1 pulado por negociacao em
  andamento e 1 registro antigo preso em `processing` (nao reenviar automaticamente).
- O funil ainda nao esta comercialmente encerrado: 153 jornadas aguardam resposta ou
  timeout; 120 jornadas estao `done`.
- Base mensuravel: 51 respostas apos 233 aberturas registradas; 33 chegaram ao pedido de
  dados e 24 responderam depois dele. Nao ha conversao `won`/`pago` registrada.
- Verificar antes da proxima campanha: envios foram observados apos 20:00 em dois dias,
  apesar da janela configurada 08:00-20:00; ha diferenca de 40 entre fila enviada e
  aberturas registradas no historico.
- Backup operacional criado em `/var/backups/evohub/20260823-050447`, validado por
  checksums e copiado para fora da VPS. O log bruto `_analytics` de aproximadamente 55 GB
  foi excluido; nao apagar dados ou WAL sem plano de retencao externo.

---

## 🟢 Sessão 08/07/2026 — Infra & Anti-perda

### Estado atual
- Nenhum deploy rodado nesta sessão (apenas mudanças de configuração)
- Branch: `master`

### Concluído nesta sessão
- Diagnosticada a perda da sessão "ORACLE" (07/07): debug-logs do VS Code sumiram, 0 turns preservados em 4 sessões
- Criado `/memories/sessoes-nao-perder.md` com checklist anti-perda
- Adicionada regra `⚠️ ANTI-PERDA` no `CLAUDE.md` global (`c:\Users\User\.claude\CLAUDE.md`)
- HANDOFF.md atualizado com alerta sobre a perda

### Decisões tomadas
- **HANDOFF.md é a ÚNICA fonte confiável de persistência entre sessões.** O session store/indexador FTS5 do VS Code é descartável.
- Agente DEVE perguntar proativamente "quer salvar handoff?" sempre que o usuário indicar que vai encerrar, mesmo sem dizer "handoff".
- Se HANDOFF.md estiver desatualizado (>24h) e usuário disser "continue", AVISAR e oferecer recriar do zero.

### Pendente / próximo passo
- [ ] Nenhuma tarefa de código pendente desta sessão — retomar da lista de pendências (§3 e §8 do HANDOFF)

---

## Sessão 03/09/2026 — Backup e auditoria de retenção

### Ponto de restauração criado

- Backup validado em `/var/backups/evohub/20260903-162030` na VPS Oracle.
- Conteúdo: dump do banco principal do EvoHub (`postgres`), configuração interna do
  Supabase sem logs analíticos descartáveis, bancos do Chatwoot e n8n, inventário de
  containers/volumes e configuração de plataforma.
- Todos os arquivos passaram por `gzip -t` e `sha256sum -c SHA256SUMS`.
- Tamanho do ponto: 296 MB. Após a geração, a VPS tinha 105 GB livres (46% em uso).
- Saúde validada após o backup: Chatwoot, Sidekiq e Supabase DB estavam `running` e
  `healthy`.

### Auditoria de mídia: fatos confirmados

- `chatwoot-media`: 3.012 objetos não possuem vínculo com `active_storage_blobs` do
  Chatwoot nem com URLs de `messages`, `clientes`, `conversations`, `customers`,
  `funnel_media` ou `products` do EvoHub. Tamanho aproximado: 2,53 GB.
- `soberano-out`: 7.472 arquivos `audio/ogg` com mais de três dias não possuem
  referência em nenhuma das mesmas fontes. Tamanho aproximado: 3,72 GB.
- As mídias canônicas ainda referenciadas (vídeos, PDFs, imagens e áudios de funil)
  foram excluídas dessa lista de candidatos e devem ser preservadas.
- A remoção anterior de vídeos repetidos permanece concluída: não há anexos restantes
  do manifesto usado naquela limpeza.

### Causa técnica e decisão pendente

- `bridge/handlers/media-retention.ts` só trata o bucket `chatwoot-media` e usa 365
  dias como padrão. Já `bridge/shared/audio.ts` grava PTT/OGG temporário em
  `soberano-out`; por isso esse volume cresceu sem retenção.
- **Nada desta nova auditoria foi apagado.** Antes de qualquer exclusão, gerar
  manifesto versionado, executar dry-run e obter autorização explícita para cada lote.
- Próxima implementação recomendada: política automática de 3 dias apenas para mídia
  temporária de campanha, cobrindo os dois buckets e ignorando toda chave que ainda
  seja referenciada por conteúdo/funil.

### Observações operacionais

- Existem alterações locais não publicadas no repositório. Não reverter, sobrescrever
  ou misturar essas mudanças durante a manutenção de infraestrutura.
- Limpeza de `public.events`, logs do Nginx e registros quebrados do ActiveStorage deve
  ser tratada em fases separadas, com janela e aprovação próprias.

### Encerramento em 04/09/2026

- Estado salvo para retomada: backup íntegro, diagnóstico concluído e nenhuma exclusão
  adicional executada após a auditoria.
- Retomar pela implementação em dry-run da retenção de três dias, com manifesto e
  validação de referências antes de solicitar autorização para apagar qualquer lote.

---

## Sessão 06/09/2026 — Canal Instagram David / conta 4

- O canal Instagram ativo `David` no EVO Hub foi reconciliado com o registro local
  `david inst`, substituindo uma referência antiga de canal inativo.
- Inbox API criada na conta Chatwoot 4: `55` (`david inst`), com webhook do bridge
  presente. A inbox antiga `51` da conta 1 foi preservada e não deve ser removida
  sem uma etapa de migração/validação própria.
- O token da conta 4 foi validado e armazenado apenas na configuração protegida do
  bridge; não registrar nem copiar o valor em documentos, logs ou commits.
- Validação final: EVO Hub `David` = `active`, registro local = `active`, inbox 55
  pertence à conta 4, token operacional do canal presente.
- O Facebook `David face` (página Agri fertil) foi reconciliado com a conta Chatwoot 4
  pela inbox API `56`; canal local, token operacional e webhook foram validados.
- Há um segundo registro local `david face` ainda em erro, preservado para não apagar
  histórico sem revisão. Não criar novos canais David: a cota do EVO Hub está completa.
- Correção futura necessária no bridge: para uma conta Chatwoot secundária com token
  próprio, o token da própria conta deve prevalecer sobre `CHATWOOT_ADMIN_TOKEN`; hoje
  o fallback global causa `401` ao criar novas inboxes na conta 4.

---

## Sessão 06-07/09/2026 — Campanhas 5895 Sudeste e 6836 Sul

### Campanha Sudeste / 5895

- ID: `camp_20260906151812`; nome: `sudeste-5895-20260906`.
- Canal: 5895 (`cf316d59-f6da-4683-adcc-29095a805dde`).
- Fluxo: 16 etapas copiadas da campanha homologada `camp_20260818023357`.
- Base bruta por DDD de SP, RJ, MG e ES: 455 contatos.
- 262 falaram nos 30 dias anteriores; 193 ficaram como candidatos sem entrada recente.
- 10 bloqueios persistentes/exclusões de automação foram removidos; 183 entraram na fila.
- Rampa: 50 no primeiro dia, +15/dia, teto 200; janela 08:00-20:00 BRT.
- Fechamento do primeiro dia: 30 enviados, 153 pendentes, 0 falhas. Primeiro envio
  às 12:20 e último às 19:52 BRT; a janela foi respeitada.
- Interação no fechamento: 3 contatos responderam, com 11 mensagens recebidas
  (3 interativas e 8 textos); 1 fluxo concluído e 29 aguardando.
- Relatório: `docs/campanha-sudeste-5895-2026-09-06.md`.
- Não recriar nem duplicar essa campanha. Ela retoma automaticamente às 08:00.

### Campanha Sul / 6836

- A campanha antiga `camp_20260825040341` enviou 70 contatos e mantém 1.950 pausados.
  Não retomá-la: pela idade, a rampa iria direto ao teto de 100/dia.
- Resultado histórico dos 70: 11 contatos responderam, 1 `won`, 5 `lost`, 0 falhas.
- Nova campanha: `camp_20260907034408`; nome: `sul-6836-20260907`.
- Canal: 6836 (`c48b43ec-83c2-46d8-bb38-d00e2fb9115f`).
- Fluxo: 16 etapas de apresentação copiadas da campanha antiga do 6836. Não usar a
  abertura do 5895, porque ela afirma que já houve conversa anterior.
- A auditoria cruzou os 1.950 números com todos os canais e aceitou equivalência com ou
  sem nono dígito. Foram excluídos 10 números únicos: 2 com conversa nos 30 dias
  anteriores e 8 encontrados por etiquetas WhatsApp nas instâncias 5895, 6836 e Mato
  Grosso. A auditoria das instâncias terminou sem erros.
- Base final: 1.940 pendentes, 0 enviados, 0 falhas, 0 pulados.
- Rampa reiniciada: 25 no primeiro dia, +5/dia, teto 100; janela 08:00-20:00 BRT.
- A execução começa automaticamente às 08:00 de 07/09/2026.
- Relatório: `docs/campanha-sul-6836-2026-09-07.md`.

### Segurança, recuperação e acompanhamento

- Antes de cada criação, foi salvo backup do `campaigns.json` no bucket privado
  `soberano-config/backups/<campaign-id>-before.json`.
- Scripts reproduzíveis: `ops/audit-sudeste-5895.ts` e `ops/start-sul-6836.ts`.
- O resumo `resumoDaFila` mostra no máximo 1.000 linhas por limite do PostgREST. Para
  campanhas maiores, usar `count: exact` ou paginação; a contagem exata da Sul é 1.940.
- Monitorar diariamente enviados, falhas, respostas, recusas e o último horário de envio.
  A fila deve parar às 20:00. Não tratar fluxo `done` como venda.
- Contatos marcados `pago`, `não compra`, `bot-off`, em negociação ou com atendimento
  pendente devem sair de campanhas futuras. A auditoria prévia cobre registros existentes;
  o sincronismo de etiquetas deve continuar ativo durante a execução.

### Auditoria em 11/09/2026

- Os canais 5895 e 6836 estavam `active`; inboxes Chatwoot 46 e 47, respectivamente.
- Sudeste/5895 (`camp_20260906151812`) concluiu a fila: 183 enviados, 0 pendentes,
  0 falhas, 0 pulados e nenhum envio depois das 20:00 em qualquer dia.
- Resultado observado no 5895: 56 contatos responderam (197 mensagens); 1 `won`,
  8 `lost`, 9 bloqueados. No fluxo, 130 estão `done` e 53 aguardam em `isca`.
- Sul/6836 (`camp_20260907034408`) tem 111 enviados, 1.829 pausados, 0 falhas e
  nenhum envio depois das 20:00. Foram observados 19 contatos respondendo; 22 `lost`,
  21 bloqueados e nenhum `won` registrado nessa leitura.
- O último disparo inicial do 6836 ocorreu em 10/09/2026 às 14:58 BRT. Os fluxos dos
  contatos já enviados continuam processando respostas e timeouts apesar da fila pausada.
- Não foi encontrada falha de canal nem de entrega que explique a interrupção. Os registros
  restantes estão explicitamente em `paused`; a origem da pausa não ficou registrada de
  forma confiável nos eventos/logs disponíveis.
- Estado para retomada: manter a fila antiga `camp_20260825040341` pausada. Para continuar
  o Sul, retomar exclusivamente `camp_20260907034408`, após autorização explícita.

## Sessao 11/09/2026 — Notas repetidas de recuperacao Instagram/Facebook

- Auditoria dos seis canais sociais: repeticao a cada cinco minutos no Atendimento IG (#787, #1388, #1896) e Campo Soberano FB (#1349, #2169). Os demais canais nao apresentaram esse aviso repetido no recorte de sete dias.
- Correcao existente 4d3000e reaproveitada em worktree isolada `.claude/worktrees/codex-social-recovery`, branch `codex/fix-social-recovery`, baseada no codigo de producao c7b4335. Commits de6ccad e 46ec85d.
- `recovery_blocked` impede nova tentativa automatica da mesma variacao ate uma entrada posterior ao bloqueio. Cadencia normal continua aplicavel. Nota de macro manual limitada atomicamente a uma por 24h; falha de leitura/gravação de bloqueio interrompe a tentativa.
- Validacao: 299 testes passaram com `deno test --no-check --allow-env --allow-read bridge/tests`; `deno check server.ts` passou.
- Publicado no SERVIDOR via origin/master: Coolify estava configurado para master (nao main). Deploy t3l5ny8xjrtlagch4q8ky64v concluido, imagem 46ec85d571a02bf32f6fc3f985e1e03940036aa1, container m8qf6ru2x75gukzozpsrssrm-194921003269.
- Primeira rodada automatica persistiu cinco bloqueios em 11/09 19:51:06–19:51:10 UTC, com um ultimo aviso por conversa. Validacao no container em producao, somente SELECT, simulou agora/+5min/+10min: scanned=5, due=0, sent=0, failed=0, dispatch=0 em todas. Nao foram enviadas mensagens de teste nem apagadas notas.
- Scripts locais: ops/audit-social-recovery.mjs, ops/verify-social-recovery.mjs, ops/verify-social-recovery-runtime.js. Auditoria original preservada em ops/audit-social-recovery-2026-09-11.json.
- SSH atual funciona com chave C:/Users/User/.ssh/oracle_ubuntu_2026 e usuario ubuntu@136.248.116.231; a memoria antiga sobre SSH indisponivel esta desatualizada.
