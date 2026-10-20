# Template de reativação — ficha pra aprovação na Meta

Submeter no **Meta Business Manager** → WhatsApp Manager → Modelos de mensagem → Criar modelo.
WABA do canal 5895: `743886211614541`.

## Campos (preencher exatamente)
- **Nome:** `reativacao_video_2026`  (minúsculas + underscore; se mudar, setar env `REATIVACAO_TEMPLATE`)
- **Categoria:** Marketing
- **Idioma:** Português (BR) — `pt_BR`
- **Cabeçalho:** Mídia → **Imagem**. Sample = arte **cand_10 limpa** ("O vizinho ficou chocado…", HD 2816×1536, tag de slide removido) — em `D:\sementes\SORGO\Imagens\selecao-header\10-vizinho-chocado-LIMPA.png`. No envio o bridge usa o slot `reativacao_header` (a mesma arte, subida no storage).
- **Corpo (copy C, sem variáveis):**

  > Tem produtor colhendo silagem de qualidade o ano todo com o Mega Sorgo Santa Elisa. Gravei um vídeo com os resultados — quer dar uma olhada?

- **Rodapé (opcional):** `Campo Soberano`  (reforça a marca; pode deixar vazio)
- **Botões:** Resposta rápida → **1 botão**: `Quero ver o vídeo`
  - Manter **1 botão**: o flow usa `fallbackNext` e qualquer clique cai no vídeo, sem código extra.
  - Se quiser um 2º botão (ex.: "Agora não"), avisa — precisa de um ajuste no hub-webhook pra ler o payload do botão (senão "Agora não" também mandaria o vídeo).

## Imagem do cabeçalho
- JPG ou PNG, ≤ 5 MB. Proporção boa: **1.91:1** (ex.: 1200×628) ou quadrada 1:1.
- O sample no BM é só exemplo de aprovação; o que sai de verdade é o `producao_img`.

## JSON (se for submeter pela Graph API em vez do BM)
Precisa primeiro do `header_handle` (upload resumável do sample); depois:
```json
{
  "name": "reativacao_video_2026",
  "language": "pt_BR",
  "category": "MARKETING",
  "components": [
    { "type": "HEADER", "format": "IMAGE", "example": { "header_handle": ["<HANDLE_DO_UPLOAD>"] } },
    { "type": "BODY", "text": "Tem produtor colhendo silagem de qualidade o ano todo com o Mega Sorgo Santa Elisa. Gravei um vídeo com os resultados — quer dar uma olhada?" },
    { "type": "BUTTONS", "buttons": [ { "type": "QUICK_REPLY", "text": "Quero ver o vídeo" } ] }
  ]
}
```
Nosso endpoint `POST /meta-templates` NÃO cria header de imagem (só body+botão) — por isso BM ou a rota resumável.

## Dicas de aprovação (Marketing)
- Sem preço, sem promessa de rendimento específico, sem link encurtado suspeito no corpo.
- Sem variável `{{1}}` (o envio só preenche a imagem do header).
- Costuma aprovar em minutos a algumas horas.

## Depois de APPROVED
`EVOHUB_ENV_PATH=.../.env node ops/prepare-reativacao-campaign.mjs` (dry-run) → `--apply` → deploy SERVIDOR → teste no número do dono → soltar loop 8–20h.
