# Spec — Painel uazapi no Soberano (prioridades do cliente)

Fonte: priorização do usuário (2026-06-14). Marca IN / DEPOIS / FORA por categoria.

## Instância / Admin (IN — alta)
- Admin: criar instância, listar todas, atualizar campos admin, **reiniciar API**.
- Instância: **conectar, desconectar, reiniciar, status, consultar limites (wa_messages_limits), renomear, deletar, config/privacidade, presença**.
- **Proxy (MUITO importante):** ver/configurar proxy + proxy gerenciado por cidade.

## Integração Chatwoot (IN — PRINCIPAL deste lado)
- PUT /chatwoot/config por instância → liga uazapi↔Chatwoot nativo (inbox por número).

## Monitor de eventos (IN — alta)
- Ver eventos do WhatsApp (webhook) tempo real + histórico; ver erros do webhook. Pra acompanhar disparo/entrega.

## Enviar mensagem (IN — alta)
- Texto (com link/preview). Mídia **separada**: imagem, vídeo, documento, áudio, **ptt** (áudio gravado), **ptv** (vídeo nota). **Sticker**. Áudio via **base64** (importante).

## Ações na mensagem (IN — média)
- Marcar lido/não lido, enviar reação. Solicitar histórico (history-sync) — se necessário. Baixar arquivo — baixa prioridade.

## Chats (IN seletivo)
- **Arquivar (muito usado)**, fixar mensagem, silenciar. FORA: deletar/desativar chat, mensagens temporárias, buscar chats c/ filtro.

## Contatos (IN — alta + visão)
- Listar contatos, adicionar/remover da agenda, obter detalhes, **verificar número no WhatsApp**.
- Visão: ao entrar um contato, puxar **o máximo de dados** e centralizar numa **agenda** (campo verificável, não só DB).

## Bloqueios (IN)
- Bloquear/desbloquear números, listar bloqueados.

## Etiquetas / listas (IN)
- Gerenciar etiquetas (criar/editar/deletar), aplicar a chat — todas as categorias.

## Grupos + Newsletters/Canais (IN — ter já, usar depois)
- Criar/gerir grupos e comunidades; canais (newsletter). Construir mesmo sem uso imediato.

## CRM (IN)
- updateFieldsMap (campos de lead), editLead.

## Mensagens em massa (IN — já feito)
- /sender/simple + /sender/advanced (timeline). ✅ base pronta.

## DEPOIS (baixa)
- Perfil (nome/imagem), Business/catálogo.

## FORA
- Chamadas (risco de ban). Respostas rápidas (descartado).

## Ordem de build sugerida
1. **Instâncias (controle) + Proxy + Chatwoot nativo + limites/status** ← começa aqui (alto valor, o Chatwoot é o principal).
2. Monitor de eventos (webhook uazapi → bridge → painel).
3. Envio: expandir tipos (ptt/ptv/documento/sticker/base64) no Disparos e envio avulso.
4. Contatos/agenda + verificar número + bloqueios + etiquetas + CRM.
5. Grupos + canais.
