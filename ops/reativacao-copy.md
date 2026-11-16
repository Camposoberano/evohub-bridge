# Campanha reativação — copy aprovada (criar template no Meta Business Manager)

Campanha: reativação dos 6.608 leads frios (Mega Sorgo). Abre a janela pelo template
oficial; no clique, o flow entrega o vídeo_3 e oferece cotação com humano.

## Template a criar no Meta Business Manager
- WABA: 5895 (`743886211614541`)
- Categoria: **MARKETING** · Idioma: **pt_BR**
- Nome sugerido: `reativacao_video_2026` (se mudar, setar env `REATIVACAO_TEMPLATE` no script/bridge)
- **Header: IMAGE** (arte = slot `producao_img`; subir um sample no BM)
- **Body (copy C, aprovada pelo dono):**

  > Tem produtor colhendo silagem de qualidade o ano todo com o Mega Sorgo Santa Elisa. Gravei um vídeo com os resultados — quer dar uma olhada?

- **Botão (quick-reply, 1):** `Quero ver o vídeo`
- Sem variável `{{1}}` no body (o envio só preenche o header de imagem).

## O que o flow manda depois do clique (já no código, não é template)
1. `video_3` — "resultados reais no campo" (legenda do próprio slot ou a curta).
2. Pergunta CTA: "Quer que eu veja o melhor pacote e o preço certo pra sua área?"
   Botões: `Quero cotação` / `Agora não`.
3. "Quero cotação" → "Perfeito! Já vou te passar pro nosso especialista…" + etiqueta
   `interesse-video` (handoff pro humano). Sem preço automático.

## Depois de APPROVED
`EVOHUB_ENV_PATH=.../.env node ops/prepare-reativacao-campaign.mjs`  (dry-run confere 6.608)
→ `--apply` (enfileira) → deploy SERVIDOR → teste no número do dono → soltar loop 8–20h.
