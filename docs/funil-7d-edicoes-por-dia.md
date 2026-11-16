# Edições do funil 7d-v1 — revisão dia a dia com o dono (2026-11-15)

Revisão da prévia enviada em 13 janelas (cada janela = bloco que termina num botão/lista).
Fonte: `bridge/shared/mega-sorgo-7d-content.ts` (33 peças) + `mega-sorgo-7d-schedule.ts` (timing).

## Timing real da cadência (confirmado no código)
- **5 minutos entre cada peça** (`PIECE_GAP_MINUTES = 5`).
- Dentro do mesmo dia: tudo de 5 em 5 min. **Entre janela 2 e 3 = 5 min.**
- Dias 2, 3, 5, 6, 7 começam às **09h** local; **dia 4 é vazio** de propósito.
- Janela de envio do funil: **08h–20h**.

## ⚠️ Regra travada que afeta as edições
- `mega-sorgo-7d-content.ts:22` — **vídeo na cadência é PROIBIDO sem o lead aceitar**
  (`"vídeo na cadência sem aceite do cliente"`). Existem **5 vídeos condicionais** que só saem
  depois do "quero ver". **Botar vídeo direto numa janela quebra a validação** — precisa decisão
  do dono pra abrir exceção (ou manter vídeo condicional).

## DIA 1 (janelas 1 a 4)
- **Janela 1** — áudio (04) + foto real (02) + botão [Quero saber mais / Só olhando]:
  ✅ **PERFEITO, não mexer.** (ordem travada: abertura tem que ser áudio→foto.)
- **Janela 2** — hoje: áudio + lista [Quanto produz?]:
  ➕ **adicionar uma IMAGEM antes do áudio** → ficar **imagem → áudio → lista**.
- **Janela 3** — hoje: só botão [Leite / Corte / Os dois]:
  ➕ **adicionar um VÍDEO curto antes do botão** → **vídeo → botão**.
  ⚠️ **CONFLITA com a regra no-vídeo-sem-aceite** — decidir: abrir exceção pra esse vídeo, ou
  deixar condicional.
- **Janela 4** (ainda dia 1) — hoje: 2 áudios + lista [Quero o segredo]:
  ➕ **adicionar um VISUAL mostrando a ALTURA/tamanho** do Mega Sorgo — o áudio fala que ele é
  grande/alto, então entra material nosso que prova o tamanho (imagem da altura; vídeo curto se o
  dono liberar — ⚠️ regra no-vídeo). Posição: junto/antes dos áudios.
  → ficar: **imagem (altura) → áudio → áudio → lista**.

## DIA 2 (janelas 5 a 8)
- **Janela 5** — botão [Milho / Capim / Não planto] ("ele REBROTA"): ✅ **ok, não mexer.**
- **Janela 6** — 2 áudios + 2 imagens (máquina/colheita) + lista ("praga e seca"): ✅ **ok.**
- **Janela 7** — hoje: só botão [Já sim / Nunca] ("resistente às pragas / já perdeu lavoura?"):
  ➕ **adicionar VÍDEO curto (que chame atenção) antes do botão** → **vídeo → botão**.
  ⚠️ mesma regra no-vídeo-sem-aceite (ver topo).
- **Janela 8** — 2 áudios + imagem (colheita na carreta) + lista ("garantir pra safra 2027"):
  ✅ **perfeita.**
- Resumo Dia 2: **só a Janela 7** muda (vídeo + botão).

> 📌 Padrão aparecendo: o dono quer **vídeo nas janelas de só-botão** (J3 dia 1, J7 dia 2). A
> decisão da regra no-vídeo-sem-aceite vai valer pra várias janelas — resolver de uma vez.
## DIA 3 (janelas 9 a 12)
- **Janela 9** — botão [Quero reservar / Me passa a condição / Vou pensar] ("condição especial"):
  ✅ **ok, deixa.**
- **Janela 10** — hoje: 2 áudios + sequência de 3 textos (depósitos/disponibilidade/frete) +
  imagem 2kg + botão de coleta:
  - 🗑️ **APAGAR as 3 mensagens de texto** (depósitos / disponibilidade / frete) — não fazem sentido.
  - 🗑️ **APAGAR a imagem/peça do preço 2 kg** — não botar volume mínimo.
  - ➕ **ADICIONAR mensagem da PROMOÇÃO**: "condição atual, até **30% de desconto**", **chamando a
    atenção pelo desconto**, SEM citar peso/volume mínimo (o lead pode querer área grande, 100 kg —
    não ancorar em 2 kg).
  - ✅ **MANTER a coleta de dados** (cidade/CEP → "Vou informar").
  - ⚠️ conferir se os **2 áudios** falam de depósito/2kg; se sim, revisar também.
- **Janela 11** — hoje: só lista ("material da Embrapa"):
  ➕ **ADICIONAR uma IMAGEM** do material Embrapa + botão **"Quer receber o material da Embrapa?"**
  (hoje é só lista, sem visual).
- **Janela 12** — botão [Sim, quero ver 🎬 / Sem vídeos agora] (porta do vídeo): ✅ ok, mas
  ➕ **adicionar IMAGEM antes do botão** (igual pediu nas de só-botão).

## DIAS 5/6/7 — Janela 13 → **REFAZER**
Hoje: 4 textos (material Embrapa, frete+desconto, "ficou dúvida?" ×2).
- 🗑️ **As 2 últimas mensagens estão DUPLICADAS** ("ficou alguma dúvida...") — tirar a repetição.
- ⚠️ **Não reofertar o material da Embrapa se o lead JÁ escolheu em J11** (condicional — senão
  repete o que ele já pediu).
- Está com **mensagem demais**. **Reescrever enxuto** os dias 5/6/7.

## NOTAS GLOBAIS (valem pra todas as janelas)
- 🔘 **Rótulo dos botões de LISTA**: hoje é tipo "Ver opções". Trocar por **"Clique aqui para ver
  opções"** (CTA explícito) — senão a pessoa não entende que tem que tocar e não clica.
- 🎬 **Vídeos pedidos** (J3 dia1, J7 dia2, imagem/vídeo em J12): a regra trava vídeo na cadência sem
  aceite. Decisão pendente: abrir exceção pra esses vídeos curtos OU usar a "porta do vídeo" (J12).
