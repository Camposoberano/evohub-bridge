# Disparo do Sul — dois fluxos, dois públicos

Fechado em 15/08/2026, depois de confirmar quais canais existem de verdade.

## O fato que define tudo

Só existem **três canais** cadastrados:

| Canal | WABA | Tipo |
|---|---|---|
| 6836 | `100191609666845` | oficial |
| 5895 | `743886211614541` | oficial |
| RyzeAPI MT | — | não oficial (teste) |

**O 0595 não é canal.** Ele é o dono de 1.719 dos 2.372 números do Sul (a lista foi exportada
do WhatsApp dele), mas não está cadastrado nem como oficial nem como uazapi. Está parado, e
cadastrá-lo exigiria semanas de aquecimento antes de qualquer volume.

Consequência: **2.040 dos 2.368 vão receber de um número que não conhecem**, faça o que
fizer. Isso não é escolha — é o estado da base.

## Os dois públicos

| Grupo | Quem conhece | Números | Fluxo | Canal |
|---|---|---|---|---|
| A | 5895 | **328** | retomada | 5895 |
| B | 0595 (sem canal) + sem dono | **2.040** | apresentação | 6836 |

Excluir sempre: 4 que já compraram, 1 que disse não, 70 com conversa nos últimos 60 dias.

## Query — separar os grupos

```sql
WITH alvo AS (
  SELECT phone, raw->>'owner' AS dono,
         CASE WHEN length(regexp_replace(phone,'\D','','g')) IN (12,13)
              THEN substring(regexp_replace(phone,'\D','','g'), 3)
              ELSE regexp_replace(phone,'\D','','g') END AS loc
  FROM clientes WHERE on_whatsapp IS TRUE
),
sul AS (
  SELECT phone, dono, substring(loc,1,2) AS ddd, right(loc,8) AS suf
  FROM alvo
  WHERE length(loc) BETWEEN 10 AND 11
    AND substring(loc,1,2) IN ('41','42','43','44','45','46','47','48','49','51','53','54','55')
),
excluir AS (
  SELECT DISTINCT
    substring(CASE WHEN length(regexp_replace(ct.phone,'\D','','g')) IN (12,13)
                   THEN substring(regexp_replace(ct.phone,'\D','','g'),3)
                   ELSE regexp_replace(ct.phone,'\D','','g') END, 1, 2) AS ddd,
    right(regexp_replace(ct.phone,'\D','','g'), 8) AS suf
  FROM contacts ct
  JOIN conversations cv ON cv.contact_id = ct.id
  LEFT JOIN messages m ON m.conversation_id = cv.id
  WHERE ct.phone IS NOT NULL
  GROUP BY 1,2
  HAVING bool_or(cv.outcome IN ('won','lost'))
      OR max(m.sent_at) >= now() - interval '60 days'
)
SELECT
  CASE WHEN s.dono = '5519999715895' THEN 'A — retomada (5895)'
       ELSE 'B — apresentacao (6836)' END AS grupo,
  count(*) AS numeros
FROM sul s
LEFT JOIN excluir e ON e.ddd = s.ddd AND e.suf = s.suf
WHERE e.suf IS NULL
GROUP BY 1;
```

Trocar o `SELECT` final por `s.phone` (com o mesmo `WHERE`) para extrair a lista de disparo
de cada grupo.

---

## Fluxo A — retomada (328 números, canal 5895)

Para quem já falou com o 5895. Pode afirmar a conversa anterior.

```json
{
  "action": "start-fluxo",
  "name": "sul-retomada-5895",
  "channel_id": "<uuid do canal 5895>",
  "delayMin": 8, "delayMax": 20,
  "numbers": ["..."],
  "flow": { "steps": [
    {"id":"video_impacto","kind":"media",
     "media":{"type":"video","url":"https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/videos/video_1.mp4"},
     "text":"Isso aqui é o Mega Sorgo Santa Elisa. Passa de 5 metros de altura."},

    {"id":"abre","kind":"buttons","delaySeg":10,
     "text":"Fala meu amigo! Aqui é o Cícero Sobreira, da Campo Soberano.\n\nA gente já conversou sobre o Mega Sorgo um tempo atrás. O senhor lembra?",
     "buttons":[{"id":"lembro","title":"Lembro sim"},{"id":"quero_preco","title":"Qual o preço"},{"id":"sem_interesse","title":"Não tenho interesse"}],
     "branches":{"lembro":"ponte","quero_preco":"preco_img","sem_interesse":"despedida"},
     "fallbackNext":"ponte","timeoutMin":1440,"onTimeout":"isca"},

    {"id":"ponte","kind":"text","next":"caminho","delaySeg":5,
     "text":"Boa! Então o senhor já sabe do que ele é capaz.\n\nDepois do corte ele rebrota — são até 3 colheitas com a mesma semente."},

    {"id":"caminho","kind":"buttons","delaySeg":10,
     "text":"O que ajuda mais o senhor agora?",
     "buttons":[{"id":"quero_preco","title":"Ver preço"},{"id":"quero_video","title":"Ver o corte"},{"id":"falar_humano","title":"Falar com Cícero"}],
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

---

## Fluxo B — apresentação (2.040 números, canal 6836)

Para quem não conhece este número. **Não afirma conversa anterior** — quem não lembra não se
sente enganado, e quem lembra reconhece o nome do Cícero sozinho.

A única diferença é o step `abre`. Todo o resto é idêntico ao fluxo A.

```json
{
  "action": "start-fluxo",
  "name": "sul-apresentacao-6836",
  "channel_id": "c48b43ec-83c2-46d8-bb38-d00e2fb9115f",
  "delayMin": 8, "delayMax": 20,
  "numbers": ["..."],
  "flow": { "steps": [
    {"id":"video_impacto","kind":"media",
     "media":{"type":"video","url":"https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/videos/video_1.mp4"},
     "text":"Isso aqui é o Mega Sorgo Santa Elisa. Passa de 5 metros de altura."},

    {"id":"abre","kind":"buttons","delaySeg":10,
     "text":"Fala meu amigo! Aqui é o Cícero Sobreira, da Campo Soberano.\n\nTrabalho com a semente do Mega Sorgo, que garante silagem no cocho mesmo no ano seco. Estou falando com os produtores da região que trabalham com gado.\n\nO senhor mexe com leite ou com corte?",
     "buttons":[{"id":"leite","title":"Leite"},{"id":"corte","title":"Corte"},{"id":"quero_preco","title":"Qual o preço"}],
     "branches":{"leite":"ponte","corte":"ponte","quero_preco":"preco_img"},
     "fallbackNext":"ponte","timeoutMin":1440,"onTimeout":"isca"},

    {"id":"ponte","kind":"text","next":"caminho","delaySeg":5,
     "text":"Boa. Então o Mega Sorgo serve certinho pro senhor.\n\nEle passa de 5 metros, e depois do corte rebrota — são até 3 colheitas com a mesma semente."},

    {"id":"caminho","kind":"buttons","delaySeg":10,
     "text":"O que ajuda mais o senhor agora?",
     "buttons":[{"id":"quero_preco","title":"Ver preço"},{"id":"quero_video","title":"Ver o corte"},{"id":"falar_humano","title":"Falar com Cícero"}],
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

## Ordem de execução

1. **Testar os dois no próprio número** — clicando do número que recebe
2. **Lote 1: 50 do grupo A** (5895). É o público mais quente e o menor risco: eles conhecem
   o número. Mede a taxa de resposta real
3. **Lote 2: 50 do grupo B** (6836), só depois de ver o resultado do A
4. **Escalar** conforme resposta, olhando a nota de qualidade entre lotes

Começar pelo A mesmo sendo menor: se a taxa de reativação for boa com quem conhece o número,
dá a régua para julgar o B. Ao contrário, não dá — um resultado ruim no B não distingue
"mensagem ruim" de "número desconhecido".

## Aberto

- `channel_id` do 5895 precisa ser pego em `SELECT id, name FROM channels WHERE name = '5895'`
- Nenhum áudio serve para reativação (os 10 existentes são das fases do funil)
- Carrossel de pacotes seria melhor que a imagem única — `hybridSendCarousel` existe, falta
  `kind: "carousel"` no motor
