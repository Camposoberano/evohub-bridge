# Verificação do Mega Sorgo 7 dias após os reparos

## Estado de entrega

Esta revisão prepara o código para um teste isolado. O roteamento dos anúncios 5895/6836 continua no funil `mega-sorgo-5895-20260930`. A versão `mega-sorgo-7d-v1` só aceita inscrição por macro autenticada e conversa explicitamente liberada em `MEGA_SORGO_7D_TEST_CONVERSATIONS`. Não usar uma conversa com outra sequência ativa.

## 1. Validação local, sem envio

1. Rodar `deno test --no-check --allow-env bridge/tests/mega-sorgo-7d-content.test.ts bridge/tests/mega-sorgo-7d-schedule.test.ts bridge/tests/n8n-action-enqueue.test.ts bridge/tests/mega-sorgo-7d-videos.test.ts bridge/tests/n8n-queue.test.ts` e `deno check bridge/server.ts`.
2. Conferir que o catálogo possui 34 peças, dez áudios, peça inicial `04` de áudio, `d5_pdf` de texto sem `media_ref`, nenhum `[nome]`, nenhum vídeo antes do aceite e nenhuma peça no dia 4.
3. Simular a agenda real com entrada às 10h BRT: as peças dos dias 1, 2, 3, 5, 6 e 7 devem cair em datas diferentes, sempre entre 08h e 20h. Repetir com entrada após 20h para verificar deslocamento para 08h do dia seguinte. A flag `test_accelerated` só pode ser `true` em uma macro da versão 7d.
4. Verificar no n8n o cron `pQFCtRhzQTKqXTjS`: a condição datada de 08/11 foi removida e a versão ativa `334f3055-aa65-4b51-95fa-bd78b4a60f89` contém somente a regra habitual 06h–20h55 para os outros funis; o bridge aplica 08h–20h para o 7d.

## 2. Ensaio em número próprio, somente com autorização de envio

1. Criar ou escolher uma conversa limpa em cada canal, ligada ao número do dono; confirmar o ID Chatwoot e o canal no banco. Incluir **apenas** esses IDs na allowlist de teste. Não alterar `channels.status` nem o roteamento dos anúncios.
2. Em janela permitida, publicar o patch no `main`, implantar o bridge e confirmar `/version` e `uptime_s`. O `build` é etiqueta manual; confirmar também o commit do Coolify. A inscrição de teste é um `POST /n8n-action-enqueue` com Bearer `N8N_ACTION_SECRET` já configurado, corpo:

```json
{
  "request": {
    "request_id": "ensaio-7d-reparos-20261109-673",
    "source": "macro",
    "chatwoot_conversation_id": 673,
    "action": "funil",
    "funnel_version": "mega-sorgo-7d-v1",
    "test_accelerated": true
  },
  "pieces": []
}
```

Substituir o ID e o `request_id` para a segunda conversa. Não imprimir ou colar o segredo em chat/log. `test_accelerated: true` agenda uma peça a cada cinco minutos dentro da janela 08h–20h; omitir a flag agenda os sete dias reais.

3. Conferir resposta `accepted: 34`, uma sequência `running` por conversa, zero peças do dia 4 e dez áudios. Repetir o mesmo pedido para confirmar `duplicate: true` e nenhuma linha nova. Conferir que a abertura chega em áudio, depois texto, e pedir confirmação no aparelho.
4. Sem clicar no convite de vídeo, verificar zero linhas `funnel = mega-sorgo-7d-v1:video`. Tocar uma vez em “Sim, quero ver”: esperar cinco linhas `official_01`–`official_05` em ordem e conferir áudio e imagem dos vídeos no aparelho. Repetir o clique: esperar zero linhas extras.
5. No convite do material, tocar “Quero o PDF 📩”: confirmar um único documento pelo fluxo `menu_isca_silagem` e a etiqueta `interesse-silagem`. Repetir no mesmo dia: o claim diário deve impedir outro envio. Não confundir a peça `d5_pdf` (texto) com o arquivo entregue sob pedido.
6. Para cada conversa, rodar `python bridge/scripts/audit-mega-sorgo-7d-test.py E:/Projetos_Novos/evohub/.env REQUEST_ID CHATWOOT_ID`, usando o `request_id` exato da inscrição. O auditor usa somente GET e mostra status da fila, registros em `messages`, vídeos e inconsistências. Uma peça `text_sequence` pode criar três mensagens com o mesmo `scheduled_message_id`; isso é esperado. `sent` no bridge não prova entregue/lido no aparelho.
7. Testar uma resposta livre em conversa descartável: o restante deve pausar; opt-out cancela. Uma retomada exige ação explícita. Não usar o mesmo teste de 34 peças para esses cenários destrutivos.

## 3. Critérios para considerar pronto

- Auditor sem questões nas duas conversas; 34 peças únicas, dez áudios, nenhum `[nome]` ou PDF automático.
- Cinco vídeos oficiais somente após aceite, sem duplicação; PDF somente após pedido, sem duplicação no mesmo dia.
- Agenda real validada por teste e janela do bridge; nenhum cliente dos anúncios entrou na versão nova.
- Após a implantação futura do código, fluxo do n8n verificado e confirmação humana das mídias no WhatsApp.

Mesmo após o ensaio, a troca dos anúncios é uma operação separada e depende de avaliação comercial do conteúdo, estoque e condições vigentes.
