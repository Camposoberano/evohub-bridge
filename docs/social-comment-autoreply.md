# Autorresposta de comentários sociais

O bridge lê as regras do arquivo `social-comment-autoreplies.json` no bucket
privado `soberano-config` do Supabase Storage. A mesma configuração atende todos
os canais Facebook e Instagram; não é necessário criar uma env por perfil.

## Regra inicial de silagem

```json
{
  "rules": [
    {
      "id": "silagem",
      "enabled": true,
      "channels": ["facebook", "instagram"],
      "keywords": ["silagem", "cilagem"],
      "reply": "TEXTO DEFINITIVO DA RESPOSTA"
    }
  ]
}
```

- A busca ignora maiúsculas, minúsculas, acentos e espaços repetidos.
- `channelIds` pode limitar uma regra a canais específicos. Sem esse campo, a
  regra vale para todos os canais das plataformas listadas.
- Uma resposta só é enviada quando `enabled` é `true` e `reply` não está vazio.
- A deduplicação usa regra, plataforma e ID do comentário. Webhook e varredura
  periódica não conseguem responder duas vezes ao mesmo comentário.
- Falhas ficam registradas em `events` com `source = social-autoreply` e podem
  ser tentadas novamente sem perder o comentário.
