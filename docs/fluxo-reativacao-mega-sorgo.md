# Fluxo de reativação — Mega Sorgo Santa Elisa

Para a base que já conhece a Campo Soberano e esfriou (2.372 no Sul, ver
`estrategia-disparo-sul.md`). Roda no motor de `shared/flow.ts` via `action: "start-fluxo"`.

## As quatro etapas

**1. Lembrança** — imagem do lote + pergunta se lembra. Objetivo único: arrancar uma
resposta. Resposta abre a janela de 24h e todo o resto sai de graça.

**2. Interesse** — áudio do Cícero e a escolha do caminho: vídeos, preço ou falar com gente.

**3. Necessidade** — a pergunta que cria conexão. Não é sobre o produto, é sobre a dor dele
(o que aperta na seca). É onde o vendedor descobre o que vender.

**4. Isca** — algo de valor real em troca da continuidade: cálculo de quanto plantar para o
rebanho dele.

## Decisões de conteúdo, e por quê

**Preço nos botões desde a etapa 1.** Nos dados, 14 das 87 respostas à fase 1 do funil atual
já perguntavam preço, e a fase 5 (onde o preço mora) tem zero perguntas — quem queria saber
já tinha ido embora. Aqui o preço está a um toque desde o começo.

**Nada de comparação técnica no início.** A fase 3 do funil atual (rebrota vs Capiaçu)
derruba a resposta de 52% para 19%. Comparar interessa a quem já decidiu plantar; quem está
decidindo *se* compra desliga.

**Os ids dos botões são os `menu_*` que o bot já roteia** (`menu_preco`, `menu_depoimento`,
`menu_plantio`, `menu_humano`). O toque cai no `handleMenuClick` e a tabela de preço ou os
vídeos saem sozinhos, sem atendente.

**Todo passo tem `fallbackNext`.** Quem digita em vez de clicar segue o fluxo — no funil
atual o cliente escreve 22× mais do que clica.

**Sem interesse encerra limpo.** Insistir com quem disse não é o caminho da denúncia, e
denúncia derruba a nota do número.

---

## JSON pronto

Trocar as URLs de mídia pelas reais antes de usar.

```json
{
  "action": "start-fluxo",
  "name": "reativacao-sul",
  "channel_id": "c48b43ec-83c2-46d8-bb38-d00e2fb9115f",
  "delayMin": 8,
  "delayMax": 20,
  "numbers": ["5511910363320"],
  "flow": {
    "steps": [
      {
        "id": "abertura",
        "kind": "media",
        "media": { "type": "image", "url": "https://TROCAR/mega-sorgo-lavoura.jpg" },
        "text": "Mega Sorgo Santa Elisa — passa de 5 metros e garante silagem no cocho mesmo no ano seco."
      },
      {
        "id": "lembra",
        "kind": "buttons",
        "text": "Fala meu amigo! Aqui é o Cícero Sobreira, da Campo Soberano.\n\nA gente conversou um tempo atrás sobre o Mega Sorgo. O senhor lembra?",
        "buttons": [
          { "id": "lembro", "title": "Lembro sim" },
          { "id": "menu_preco", "title": "Qual o preço" },
          { "id": "sem_interesse", "title": "Não tenho interesse" }
        ],
        "branches": {
          "lembro": "audio_cicero",
          "menu_preco": "audio_cicero",
          "sem_interesse": "despedida"
        },
        "fallbackNext": "audio_cicero",
        "timeoutMin": 1440,
        "onTimeout": "isca"
      },

      {
        "id": "audio_cicero",
        "kind": "media",
        "media": { "type": "audio", "url": "https://TROCAR/cicero-retomada.ogg" }
      },
      {
        "id": "caminho",
        "kind": "buttons",
        "text": "O que ajuda mais o senhor agora?",
        "buttons": [
          { "id": "menu_preco", "title": "Ver preço" },
          { "id": "menu_depoimento", "title": "Ver os vídeos" },
          { "id": "menu_humano", "title": "Falar com Cícero" }
        ],
        "branches": {
          "menu_preco": "necessidade",
          "menu_depoimento": "necessidade",
          "menu_humano": "despedida"
        },
        "fallbackNext": "necessidade",
        "timeoutMin": 720,
        "onTimeout": "isca"
      },

      {
        "id": "necessidade",
        "kind": "buttons",
        "text": "Deixa eu te perguntar uma coisa, que é o que mais importa:\n\nNa última seca, o que mais apertou aí na sua propriedade?",
        "buttons": [
          { "id": "faltou_pasto", "title": "Faltou pasto" },
          { "id": "custo_racao", "title": "Ração cara demais" },
          { "id": "deu_conta", "title": "Deu pra segurar" }
        ],
        "branches": {
          "faltou_pasto": "dor_pasto",
          "custo_racao": "dor_custo",
          "deu_conta": "dor_prevencao"
        },
        "fallbackNext": "dor_pasto",
        "timeoutMin": 720,
        "onTimeout": "isca"
      },

      {
        "id": "dor_pasto",
        "kind": "text",
        "text": "Pois é, meu amigo. Ver o gado emagrecendo com o pasto pelado é o que mais dói.\n\nO Mega Sorgo resolve isso porque o senhor corta e ele rebrota — são até 3 colheitas com a mesma semente, e a raiz busca água fundo mesmo no ano seco."
      },
      {
        "id": "dor_custo",
        "kind": "text",
        "text": "Essa é a conta que não fecha mesmo. Ração comprada come o lucro todo.\n\nCom o Mega Sorgo o senhor faz a silagem na própria terra: gasta menos de 1 real por dia por cabeça, e ainda são até 3 colheitas com a mesma semente."
      },
      {
        "id": "dor_prevencao",
        "kind": "text",
        "text": "Que bom, meu amigo. Quem segurou uma seca sabe o valor de não depender de comprar trato.\n\nO Mega Sorgo é justamente pra garantir que a próxima também passe tranquila — silagem estocada, feita na sua terra."
      },

      {
        "id": "isca",
        "kind": "buttons",
        "text": "Posso fazer uma conta pro senhor sem compromisso?\n\nMe diz o tamanho da área e quantas cabeças o senhor tem, que eu calculo quanta silagem dá pra tirar e quanto de semente precisa. Assim o senhor vê o número antes de decidir qualquer coisa.",
        "buttons": [
          { "id": "quero_conta", "title": "Quero a conta" },
          { "id": "menu_preco", "title": "Só o preço" },
          { "id": "sem_interesse", "title": "Agora não" }
        ],
        "branches": {
          "quero_conta": "pede_dados",
          "menu_preco": "fim",
          "sem_interesse": "despedida"
        },
        "fallbackNext": "pede_dados",
        "timeoutMin": 2880,
        "onTimeout": "ultima"
      },
      {
        "id": "pede_dados",
        "kind": "text",
        "text": "Boa! Me manda aqui: quantos hectares o senhor tem disponível e quantas cabeças de gado.\n\nPode ser por áudio se for mais fácil. Faço a conta e te mando."
      },

      {
        "id": "ultima",
        "kind": "text",
        "text": "Meu amigo, não quero incomodar. Se em algum momento fizer sentido garantir a silagem da próxima seca, é só me chamar aqui que eu te ajudo."
      },
      { "id": "despedida", "kind": "text", "text": "Tranquilo, meu amigo. Qualquer coisa é só chamar. Bom trabalho aí!" },
      { "id": "fim", "kind": "end" }
    ]
  }
}
```

## Como os caminhos se fecham

| Resposta | Vai para |
|---|---|
| Lembra / pergunta preço | áudio → escolha de caminho → necessidade → isca |
| "Não tenho interesse" | despedida, e o fluxo encerra |
| Não responde em 24h | pula direto para a isca |
| Não responde à isca em 48h | última mensagem e encerra |
| Digita texto livre | segue o caminho principal (`fallbackNext`) |

O gatilho de necessidade tem três respostas **diferentes** — a mesma objeção tratada de
formas distintas é o que faz parecer conversa e não roteiro.

## Antes de disparar

1. **Trocar as URLs** de imagem e áudio pelas reais (bucket `soberano-out/mega-sorgo/`)
2. **Gravar o áudio** de retomada — pelos dados de escuta, PTT (bolha de voz) tem abertura
   muito maior que arquivo; o motor já converte e envia como `ptt`
3. **Testar no próprio número** antes da lista, clicando **do número que recebe** (clicar
   pela conta que envia gera `fromMe: true` e o bridge ignora, corretamente)
4. **Lote pequeno primeiro** — 50 contatos, medir resposta antes de escalar

## Aberto

- O `channel_id` acima é o do 6836. Se a lista for roteada por dono (`raw->>'owner'`), cada
  grupo precisa da sua chamada com o canal correspondente.
- Não há passo de carrossel aqui: vale quando houver fotos de vários pacotes (2kg, 4kg,
  10kg) com preço por cartão.
