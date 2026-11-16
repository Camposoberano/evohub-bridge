# Auditoria manual de falhas históricas do funil

**Data da consulta:** 2026-10-08
**Escopo:** leitura somente de produção; janela aproximada de 72 horas, iniciando em 2026-10-05 às 01:00 (Fortaleza).
**Privacidade:** este resumo omite nomes, telefones, IDs de conversa e URLs completas.

## Resultado global da fila

Foram encontradas **48 linhas de `scheduled_messages` em `failed`** na janela:

- **45 vídeos**
- **2 listas**
- **1 áudio**

Das 45 etapas de vídeo, **44 não tinham linha correspondente em `messages`**. A etapa restante de vídeo, as duas listas e o áudio tinham linha de saída local com `status=failed`, sem `meta_message_id`. Não havia evento correspondente `send_failed`, `message_failed` ou `send_uncertain` com o resultado do provedor. Portanto, o banco não preservou o motivo da falha nem prova suficiente para autorizar reenvio automático.

## Escopo específico de anúncios

Uma consulta anterior, restrita às conversas de anúncio daquele recorte de 5 a 7 de outubro, encontrou **42 conversas de anúncio** e **38 etapas falhas associadas** (**36 vídeos e 2 listas**). Esse universo não é o mesmo da contagem global de 48 itens da fila; não some as duas contagens.

## Checagem de mídia

O catálogo ativo tinha **173 linhas e 65 URLs distintas**; as 65 URLs responderam HTTP 200 na verificação. As quatro URLs distintas presentes nas linhas de vídeo falhas também responderam HTTP 200 e eram arquivos MP4 entre **12,3 MB e 16,0 MB**.

HTTP 200 confirma que o objeto existe no storage. Não confirma que a Meta conseguiu buscar, decodificar ou aceitar o vídeo. Como o erro HTTP e o corpo de resposta do provedor não foram guardados, não é possível determinar a causa histórica com segurança.

## Encaminhamento manual

Nenhuma conversa histórica foi reenviada e nenhum arquivo foi restaurado. Os dados atuais não distinguem com confiança uma rejeição definitiva de um resultado de entrega incerto, e os arquivos que responderam HTTP 200 ainda podem falhar por formato ou processamento no provedor.

Para cada item antigo, a revisão manual deve conferir o log preservado do bridge/Meta pelo horário e pelo registro local, validar o ativo e confirmar que a mensagem não foi entregue antes de qualquer reenvio. O endpoint de retry foi limitado a rejeições 429 documentadas; falhas antigas sem diagnóstico são bloqueadas para revisão individual.
