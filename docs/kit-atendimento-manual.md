# Kit de atendimento na mão — Mega Sorgo Santa Elisa

> Montado em **02/11/2026** para atender os leads mornos do **0595** sem disparo automático.
> Todas as peças abaixo foram testadas por HTTP neste dia e **responderam OK** — a biblioteca
> do funil que havia sido apagada em 08/09 está de volta no bucket `soberano-out`.
>
> O disparo automático do 0595 está **parado** (ver `AGENTS.md`, seção "Decisões travadas").
> Nada daqui sai sozinho: é material para o atendente enviar.

## Como mandar

Pelo **Chatwoot** (`gerenciador.soberano.pro`, conta 1, inbox 48 = canal 0595). Cole o link da
mídia na própria caixa de mensagem, ou baixe e anexe. O envio pelo Chatwoot volta a funcionar
desde 02/11 — antes disso o canal estava marcado `inactive` e o `sync-chatwoot-out` o pulava,
então a mensagem morria em silêncio.

Pelo **aparelho** também funciona (a uazapi espelha depois no Chatwoot).

---

## 1. Preço — cards por pacote

O lead travou na pergunta *"qual área você pretende plantar?"*. A área define o pacote:

| área do lead | peça a mandar | link |
|---|---|---|
| até 0,5 ha (teste) | pacote 2 kg | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/pacote-2kg.jpg |
| até 1 ha | pacote 4 kg | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/pacote-4kg.png |
| até 2 ha | pacote 10 kg | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/pacote-10kg.png |
| até 4 ha | pacote 20 kg | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/pacote-20kg.png |

Acima de 4 ha não há card: é cotação direta.

⚠️ **Valor fechado é cotação do Cícero, por volume.** A regra travada do projeto é que o
automático não manda `R$` — quanto maior a área, melhor o preço, então número solto vira
promessa errada. Mandando na mão você pode cotar: é exatamente o caso previsto.

Referência interna (não é peça pronta): em 02/11 o 5895 enviou *"preço-base R$ 89,95/kg"* de
forma automática. Isso **contraria** a regra acima — ou a regra mudou, ou existe peça furando
ela. Vale conferir antes de usar esse número como oficial.

## 2. Plantio

| peça | o que é | link |
|---|---|---|
| imagem | recomendação de plantio (1 tela, boa pra WhatsApp) | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/imagens/recomendacao-plantio.jpg |
| PDF | Instruções de Plantio completas (~11 MB) | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/instrucoes-plantio.pdf |
| vídeo | VÍDEO 02 — Como plantar (~10 MB) | https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/videos/video_2.mp4 |

Legenda pronta do vídeo 02:

```
🌾 *VÍDEO 02 — Como plantar o Mega Sorgo Santa Elisa*

✅ Plantio *simples*, sem segredo — até quem nunca plantou consegue
✅ Dicas de *espaçamento, época ideal e adubação*

👉 _Veja o passo a passo completo:_
https://youtu.be/mkzRsa8RaKw
```

Para quem só quer a resposta rápida, a **imagem** entrega melhor que o PDF de 11 MB.

## 3. Nutrição

Análise bromatológica (Laboratório Prado) — documento técnico, bom para quem pergunta valor
nutricional ou compara com milho:

https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/docs/analise-bromatologica-laboratorio-prado.pdf

## 4. Vídeo de reativação

É a peça que o laço automático vinha mandando a cada 10 minutos (e que foi parada). Só mande
para quem **ainda não recebeu** — os 19 leads em passo `video` já receberam hoje:

https://bancortovital.soberano.pro/storage/v1/object/public/soberano-out/mega-sorgo/videos/video-reativacao.mp4

Legenda: `🎥 Olha o que o Mega Sorgo faz na lavoura 👇`

---

## Ordem sugerida para os 26 mornos

1. **puxe pelo que a pessoa fez**, não comece peça nova: *"o senhor chegou a ver o vídeo do
   Mega Sorgo — me diz a área que pretende plantar que eu já separo o volume certo"*;
2. respondeu a área → manda o **card do pacote** correspondente;
3. perguntou como planta → **imagem de plantio** (PDF só se pedir o detalhe);
4. perguntou nutrição/comparativo com milho → **PDF bromatológico**;
5. pediu valor fechado ou área acima de 4 ha → **cotação do Cícero**.

**7 dos 26 pararam há 4 dias ou menos** — contato natural. **19 pararam há 5 a 11 dias**: para
esses, retomar com peça do funil se parece com disparo frio outra vez, que é o risco de
bloqueio que motivou a parada. Puxe pela conversa, um por vez, não em rajada.
