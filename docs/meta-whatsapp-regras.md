# Regras da Meta — WhatsApp Business Platform (referência)

> Última verificação: **2026-06-13**. Fonte: documentação oficial Meta for Developers.
> Regras mudam com frequência — reverificar a cada ~30 dias (ver changelog no fim).

## Janela de atendimento (24h customer service window)

- Cliente te manda mensagem/ligação → abre um **timer de 24h**. Nova mensagem do cliente **reseta** pra 24h.
- **Dentro da janela (24h):** pode mandar **qualquer tipo** — texto livre, mídia, interativo.
- **Fora da janela:** **só template aprovado**. É o único tipo permitido fora das 24h.
- **FEP (Free Entry Point):** se o contato veio de um ponto de entrada gratuito e você responde em 24h, abre janela **72h** grátis pra qualquer tipo de mensagem. Independente da janela de 24h.

**Impacto pro disparo:** reativar cliente sem contato há 60 dias = **fora da janela** = **template obrigatório**.

## Limites de envio (messaging limits / tiers)

- Portfólio novo começa em **250** clientes únicos / 24h.
- Escala: **250 → 1.000 → 10.000 → 100.000 → ilimitado**.
- **Auto-scaling:** entregar **1.000** mensagens (fora da janela, template, qualidade alta) a usuários únicos em janela móvel de 30 dias + estar aprovado pro auto-scaling → sobe pra 1.000 na hora.
- **Queda:** se o quality rating ficar **Flagged por 7 dias** → cai **um nível** imediatamente.
- O limite conta **clientes ÚNICOS** por 24h, não total de mensagens.

**Impacto:** não dá pra disparar 10k no dia 1. Precisa **aquecer** (subir tier) e manter qualidade.

## Quality rating

- Estados: **Green (alta) / Yellow (média/Flagged) / Red (baixa)**.
- Cliente **bloquear ou denunciar** derruba a qualidade.
- Qualidade baixa sustentada → Meta **limita/bloqueia** o número.
- Cada número tem um **status** que reflete quality + limite atual.

## Templates

- Categorias: **Marketing / Utility / Authentication**. Precisam **aprovação** da Meta.
- Template tem **quality rating próprio** (pode ser pausado se ruim).
- Mídia (imagem/vídeo/doc) vai no **header** do template — usa um **media handle reusado** (upload 1x).

### Limite por usuário (per-user marketing limits) — regra nova
- A Meta limita **quantos templates de marketing um usuário recebe de QUALQUER empresa** por período (frequency cap). Não é só o seu volume — o usuário pode já estar "cheio".
- **EUA:** entrega de template de marketing **pausada desde 01/04/2025** pra números dos EUA.
- **Mudança de limites em 07/10/2025** (ver doc de upcoming changes).

## Pricing

- Migrou de **por conversa** (deprecado) para **por mensagem**. Recalcular custo de disparo por mensagem enviada.

## Opt-in

- Template de marketing exige **consentimento** do cliente (opt-in). Sem opt-in → risco de denúncia → ban.

## Links oficiais (reverificar)

- Limites: https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits
- Mudanças de limite: https://developers.facebook.com/documentation/business-messaging/whatsapp/upcoming-messaging-limits-changes/
- Janela/envio: https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages
- Templates: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview
- Limite por usuário: https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/per-user-limits/
- Pricing: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing
- Política: https://business.whatsapp.com/policy
- **Changelog (checar updates):** https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog
