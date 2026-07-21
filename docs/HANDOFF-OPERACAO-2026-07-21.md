# Handoff operacional - 2026-07-21

## Escopo decidido

1. Funil completo: homologado e encerrado como pronto.
2. Monitoramento: ciclo de sete dias iniciado pelo bridge, com auditoria a cada 15 minutos.
3. Segredos, webhooks e revogacoes: pendente por decisao operacional. Nao executar nesta fase.
4. IA e automacoes: reativadas. Audio usa Gemini com modelo principal e fallback estavel; OpenAI permanece como ultimo fallback quando houver saldo.
5. Cadastro do lead: nome, foto quando fornecida, telefone quando fornecido, ID de plataforma, canal, numero receptor, responsavel, anuncio, campanha e criativo passam a ser preservados.
6. VPS antiga: fora do escopo. Nao desligar, limpar ou usar como condicao de homologacao.

## Alteracoes desta rodada

- `0007_lead_attribution_monitoring.sql` adiciona rastreabilidade estruturada por conversa.
- O ingresso nao sobrescreve mais atributos antigos do contato ao receber um novo `source_id`.
- Todo novo lead de WhatsApp e criado ou atualizado em `clientes` automaticamente.
- Referencias de anuncio da Meta, UazAPI e RyzeAPI sao normalizadas e preservadas em formato bruto e estruturado.
- Facebook e Instagram tentam obter nome, username e foto; telefone fica explicitamente como nao fornecido pela Meta ate compartilhamento pelo cliente.
- O painel Central exibe saude operacional e permite atribuir um responsavel a cada canal/numero.
- Alertas sao registrados em `events` sem PII quando ha canal desconectado, falha de envio, fila atrasada, lead sem ID, lacuna de atribuicao, nome/foto ausentes ou numero sem responsavel.

## Backfill aplicado no Supabase novo

- 207 conversas receberam snapshot de canal e ID do lead.
- 212 contatos receberam atributos de origem/canal.
- 179 numeros de WhatsApp foram consolidados em `clientes`.

## IA de audio

- A chave Gemini foi validada.
- `gemini-3.5-flash` respondeu com indisponibilidade temporaria durante a auditoria.
- `gemini-2.5-flash` transcreveu o mesmo audio com sucesso.
- Producao foi ajustada para `GEMINI_TRANSCRIBE_MODEL=gemini-2.5-flash`.
- O codigo tenta um modelo Gemini alternativo e, por ultimo, OpenAI quando configurada e com saldo.

## Limites reais dos dados

- WhatsApp: telefone e ID ficam disponiveis; foto depende da privacidade do usuario e da resposta do provedor de perfil.
- Facebook/Instagram: PSID/IGSID, nome/username, canal e origem sao salvos. A Meta nao entrega telefone por padrao; ele so deve ser preenchido quando o proprio cliente compartilhar.
- Nome e foto ausentes geram alerta, mas nao devem ser inventados.

## Pendencias deliberadas

- Atribuir no painel o nome/identificador do vendedor responsavel por cada canal.
- Observar os alertas e entregas durante os sete dias completos.
- Depois da observacao, revisar e eventualmente revogar segredos antigos. Esta acao continua bloqueada por decisao do usuario.
