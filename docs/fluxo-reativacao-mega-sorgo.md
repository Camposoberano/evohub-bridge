# Fluxo de reativação — Mega Sorgo Santa Elisa

Para a base que já conhece a Campo Soberano e esfriou (2.372 no Sul, ver
`estrategia-disparo-sul.md`). Roda no motor de `shared/flow.ts` via `action: "start-fluxo"`.

Testado em produção em 14–15/08/2026. Os textos são ponto de partida — a voz é do Cícero.

## O ângulo: tamanho e validação

O que para o dedo do produtor é **ver a altura**. Por isso abre com vídeo, não com foto:
5 metros se mostram em movimento. Depois vem quem fala, e só então a pergunta.

## As quatro etapas

**1. Impacto** — vídeo do sorgo alto, com a altura no texto.
**2. Reconhecimento** — quem é, e a pergunta que arranca resposta ("o senhor lembra?").
   Resposta abre a janela de 24h e todo o resto sai de graça.
**3. Necessidade** — a pergunta que cria conexão não é sobre o produto, é sobre a dor dele
   (o que apertou na última seca). Três respostas, três textos diferentes.
**4. Isca** — calcular quanta silagem a área dele rende. Valor real em troca dos dois dados
   que o vendedor precisa: hectares e cabeças.

## Decisões de conteúdo, e por quê

**Preço a um toque desde a etapa 1.** Nos dados, 14 das 87 respostas à fase 1 do funil atual
já perguntavam preço, e a fase 5 — onde o preço mora — tem **zero**: quem queria saber já
tinha ido embora.

**Nada de comparação técnica no início.** A fase 3 do funil (rebrota vs Capiaçu) derruba a
resposta de 52% para 19%. Comparar interessa a quem já decidiu plantar.

**Cada botão entrega o conteúdo pelo próprio fluxo.** Botão com id `menu_preco` **não**
funciona aqui: `continueFlowOnReply` consome a mensagem e o `handleMenuClick` nunca roda —
o lead clicaria e receberia silêncio. Por isso `quero_preco` aponta para um step que manda a
imagem e volta ao caminho.

**Ritmo de 4 a 12 segundos** entre as peças (`delaySeg`). Sem isso tudo chega no mesmo
segundo e o lead não lê nada.

**Quem diz que não tem interesse encerra limpo.** Insistir é o caminho da denúncia, e
denúncia derruba a nota do número.

---

## JSON pronto

```json
{
  "action": "start-fluxo",
  "name": "reativacao-sul",
  "channel_id": "c48b43ec-83c2-46d8-bb38-d00e2fb9115f",
  "delayMin": 8, "delayMax": 20,
  "numbers": ["5511910363320"],
  "flow": { "steps": [
    {"id":"video_impacto","kind":"media",
     "media":{"type":"video","url":"https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/videos/video_1.mp4"},
     "text":"Isso aqui é o Mega Sorgo Santa Elisa. Passa de 5 metros de altura."},

    {"id":"lembra","kind":"buttons","delaySeg":10,
     "text":"Fala meu amigo! Aqui é o Cícero Sobreira, da Campo Soberano.\n\nA gente já conversou sobre o Mega Sorgo um tempo atrás. O senhor lembra?",
     "buttons":[{"id":"lembro","title":"Lembro sim"},{"id":"quero_preco","title":"Qual o preço"},{"id":"sem_interesse","title":"Não tenho interesse"}],
     "branches":{"lembro":"corte","quero_preco":"preco_img","sem_interesse":"despedida"},
     "fallbackNext":"corte","timeoutMin":1440,"onTimeout":"isca"},

    {"id":"corte","kind":"text","next":"caminho","delaySeg":5,
     "text":"Boa! Então o senhor já sabe do que ele é capaz.\n\nDepois do corte ele rebrota — são até 3 colheitas com a mesma semente."},

    {"id":"caminho","kind":"buttons","delaySeg":10,
     "text":"O que ajuda mais o senhor agora?",
     "buttons":[{"id":"quero_preco","title":"Ver preço"},{"id":"quero_video","title":"Ver mais vídeos"},{"id":"falar_humano","title":"Falar com Cícero"}],
     "branches":{"quero_preco":"preco_img","quero_video":"video_corte","falar_humano":"humano"},
     "fallbackNext":"necessidade","timeoutMin":720,"onTimeout":"isca"},

    {"id":"preco_img","kind":"media","next":"necessidade","delaySeg":4,
     "media":{"type":"image","url":"https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/promocao-safrinha.jpg"},
     "text":"Essa é a condição atual, com frete grátis e nota fiscal."},

    {"id":"video_corte","kind":"media","next":"necessidade","delaySeg":4,
     "media":{"type":"video","url":"https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/videos/video_2.mp4"},
     "text":"Olha o corte na prática."},

    {"id":"humano","kind":"text","text":"Já te conectei com o Cícero. Ele responde aqui mesmo, meu amigo."},

    {"id":"necessidade","kind":"buttons","delaySeg":12,
     "text":"Deixa eu te perguntar uma coisa, que é o que mais importa:\n\nNa última seca, o que mais apertou aí na sua propriedade?",
     "buttons":[{"id":"faltou_pasto","title":"Faltou pasto"},{"id":"custo_racao","title":"Ração cara"},{"id":"deu_conta","title":"Deu pra segurar"}],
     "branches":{"faltou_pasto":"dor_pasto","custo_racao":"dor_custo","deu_conta":"dor_prevencao"},
     "fallbackNext":"dor_pasto","timeoutMin":720,"onTimeout":"isca"},

    {"id":"dor_pasto","kind":"text","next":"isca","delaySeg":6,
     "text":"Pois é. Ver o gado emagrecendo com o pasto pelado é o que mais dói.\n\nCom 5 metros de altura, um hectare enche muito cocho."},
    {"id":"dor_custo","kind":"text","next":"isca","delaySeg":6,
     "text":"Ração comprada come o lucro todo.\n\nAqui o senhor faz a silagem na própria terra, e corta 3 vezes com a mesma semente."},
    {"id":"dor_prevencao","kind":"text","next":"isca","delaySeg":6,
     "text":"Quem segurou uma seca sabe o valor de não depender de comprar trato.\n\nO Mega Sorgo é pra garantir que a próxima também passe tranquila."},

    {"id":"isca","kind":"buttons","delaySeg":10,
     "text":"Posso fazer uma conta pro senhor, sem compromisso?\n\nMe diz a área e quantas cabeças, que eu calculo quanta silagem dá e quanto de semente precisa.",
     "buttons":[{"id":"quero_conta","title":"Quero a conta"},{"id":"ver_pacotes","title":"Ver os pacotes"},{"id":"sem_interesse","title":"Agora não"}],
     "branches":{"quero_conta":"pede_dados","ver_pacotes":"pacotes","sem_interesse":"despedida"},
     "fallbackNext":"pede_dados","timeoutMin":2880,"onTimeout":"ultima"},

    {"id":"pacotes","kind":"media","next":"pede_dados","delaySeg":4,
     "media":{"type":"image","url":"https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/pacote-10kg.png"},
     "text":"Esse é o pacote de 10 kg. Tem de 2, 4, 10 e 20 kg — depende do tamanho da sua área."},

    {"id":"pede_dados","kind":"text","delaySeg":5,
     "text":"Me manda aqui: quantos hectares e quantas cabeças de gado.\n\nPode ser por áudio, se for mais fácil."},
    {"id":"ultima","kind":"text","text":"Meu amigo, não quero incomodar. Se fizer sentido garantir a silagem da próxima seca, é só me chamar."},
    {"id":"despedida","kind":"text","text":"Tranquilo, meu amigo. Qualquer coisa é só chamar. Bom trabalho aí!"}
  ]}
}
```

## Mídia — o que existe e os limites

| Peça | Arquivo | Tamanho | Limite Meta |
|---|---|---|---|
| Vídeo impacto | `videos/video_1.mp4` | 13,6 MB | 16 MB ✅ |
| Vídeo corte | `videos/video_2.mp4` | 8,2 MB | ✅ |
| Preço | `imagens/promocao-safrinha.jpg` | 857 KB | 5 MB ✅ |
| Pacote 10kg | `imagens/pacote-10kg.png` | 2,1 MB | ✅ |
| ~~Capa~~ | `imagens/capa-mega-sorgo.png` | **7,5 MB** | ❌ **acima** |

**A capa não pode ser usada no canal oficial.** A Meta recusa com
`(#100) Param image.link is not a valid URI` — mensagem genérica dela para arquivo que não
consegue processar. Se o funil de produção usa essa capa em alguma fase, ela nunca foi
entregue; vale conferir.

**Áudio:** existem 10 (dois por fase do funil), mas nenhum foi gravado para reativação. O
`audio_01_-_fase_01.ogg` é a apresentação de quem está chegando, não de quem já conhece — soa
errado aqui. Para incluir, gravar um curto de retomada e adicionar como
`{"id":"audio","kind":"media","media":{"type":"audio","url":"…"},"next":"caminho"}`. O motor
converte para bolha de voz (`ptt`) sozinho.

## Antes do disparo real

1. **Testar no próprio número**, clicando **do número que recebe** — clicar pela conta que
   envia gera `fromMe: true` e o bridge ignora, corretamente
2. **Disparar uma vez só** e esperar: com os intervalos, o bloco leva perto de um minuto
3. **Lote de 50** antes de escalar
4. **Roteamento por dono** (`raw->>'owner'`): cada lead recebe do número que o conhece

## Aberto

- O `channel_id` acima é o do 6836. Roteando por dono, cada grupo precisa da sua chamada.
- Carrossel de pacotes (2/4/10/20 kg com preço por cartão) seria melhor que a imagem única —
  `hybridSendCarousel` existe, mas ainda não há `kind: "carousel"` no fluxo.
