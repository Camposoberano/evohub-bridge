# Operação Facebook e Instagram

Atualizado em 13/07/2026.

## Objetivo

Centralizar no Chatwoot:

- mensagens diretas do Facebook Messenger e Instagram Direct;
- comentários de publicações e anúncios;
- respostas públicas aos comentários;
- publicações feitas pelo MultiPost, sem exigir integração direta entre os dois sistemas.

## Canais validados

| Plataforma | Canal | Estado |
| --- | --- | --- |
| Facebook | Atendimento FB | ativo |
| Facebook | Campo Soberano | ativo |
| Facebook | Mega Sorgo Santa Elisa | ativo |
| Instagram | Atendimento IG | ativo |
| Instagram | Sorgo Brasileiro | ativo |

## Fluxo operacional

1. A Meta entrega mensagens e comentários ao webhook do EVO Hub.
2. O bridge identifica o canal, cria ou reutiliza contato e conversa no Chatwoot e salva no Supabase.
3. A resposta escrita no Chatwoot é enviada pela Graph API.
4. Um pull de segurança roda a cada 30 segundos para mensagens e a cada 5 minutos para comentários.
5. Cada comentário usa uma conversa própria, evitando responder ao comentário errado quando
   a mesma pessoa comenta mais de uma publicação.
6. A deduplicação por ID da Meta impede que webhook e pull criem duas mensagens.
7. Falha no processamento libera a entrega e retorna erro para permitir retry do webhook.
8. A varredura percorre páginas adicionais da Graph API; falhas de envio geram nota privada
   no Chatwoot para o atendente não confundir tentativa com entrega confirmada.

Facebook responde comentário em `/{comment-id}/comments`. Instagram responde em
`/{comment-id}/replies`. Comentários da própria página/conta são ignorados na entrada.

## Permissões da aplicação Meta

A autorização do canal deve incluir, conforme o produto habilitado na aplicação:

- Facebook: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`,
  `pages_read_engagement`, `pages_read_user_content` e `pages_manage_engagement`;
- Instagram: `instagram_basic`, `instagram_manage_messages`,
  `instagram_manage_comments`, `pages_show_list` e `pages_read_engagement`.

Para contas que não sejam administradores/testadores da aplicação, as permissões precisam
de acesso avançado e revisão da Meta.

## MultiPost

O MultiPost continua responsável somente pela publicação. O EvoHub consulta e recebe eventos
da página/conta conectada, portanto também reconhece comentários em posts criados pelo
MultiPost. Não é necessário duplicar credenciais ou transferir a função de postagem.

## Teste de homologação

1. Enviar uma DM para cada um dos cinco canais e responder pelo Chatwoot.
2. Com um perfil externo, comentar `teste evohub 01` em um post do Facebook.
3. Confirmar que a conversa aparece e responder pelo Chatwoot.
4. Repetir no Instagram com `teste evohub 02`.
5. Confirmar que cada comentário aparece uma vez e que a resposta pública fica no comentário correto.

O teste de comentário é obrigatório antes de habilitar respostas automáticas. Automação deve
começar em modo rascunho/aprovação humana, com limite por usuário e proteção contra loops.
