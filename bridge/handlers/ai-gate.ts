// ai-gate — endpoint do contactAuth do fazer.ai. O agente "Vendedor Agro" consulta
// aqui ANTES de cada resposta: só libera (`authorized:true`) se a conversa estiver na
// lane de IA (label `ai-vendas`) e o bot não estiver calado à mão (`bot-off`). Qualquer
// outra coisa nega — e o fazer.ai é fail-closed, então negar = nenhum turno.
//
// Contrato (fazer.ai docs/contact-auth.md):
//   POST application/json
//   { "contact": { "phone", "name", "email", "identifier", "chatwootContactId" },
//     "conversation": { "id", "inboxId", "channel" },
//     "message": { "text" } }        // message só com includeMessageText
//   Resposta: 2xx { "authorized": boolean, "reason"?: <code>, "context"?: object }.
//   401/403/404 = negado; qualquer outro status / timeout / erro = ERRO (fail-closed).
//
// Auth: o fazer.ai injeta o credentialRef do vault como `Authorization: Bearer <segredo>`
// (ou query/header). Aceitamos Bearer e `?token=`, conferidos em tempo constante.
import { admin } from "../shared/supabase.ts";
import { optionalEnv } from "../shared/env.ts";
import { confereSegredo } from "../shared/segredo-bridge.ts";
import { isBotMutedForContact } from "../shared/bot-mute.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { getConversationLabels } from "../shared/chatwoot.ts";
import { hasAiLaneLabel } from "../shared/ai-lane.ts";

type Json = Record<string, unknown>;

function allow(reason?: string): Response {
  return Response.json({ authorized: true, ...(reason ? { reason } : {}) });
}
// `reason` tem que ser um CÓDIGO curto (o fazer.ai dropa prosa): /^[a-z0-9][a-z0-9._-]{0,63}$/i
function deny(reason: string): Response {
  return Response.json({ authorized: false, reason });
}

function tokenFromRequest(req: Request, url: URL): string {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return url.searchParams.get("token") ?? "";
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  const url = new URL(req.url);

  // Sem segredo configurado ou token errado → 401 (o fazer.ai lê como NEGADO). Nunca
  // libera sem autenticar: um /ai-gate aberto deixaria qualquer um soltar o bot.
  const expected = optionalEnv("AI_GATE_SECRET");
  const token = tokenFromRequest(req, url);
  if (!expected || !confereSegredo(token, [expected], "ai-gate")) {
    return new Response("unauthorized", { status: 401 });
  }

  let p: Json;
  try {
    p = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }

  const conversation = (p.conversation ?? {}) as Json;
  const contact = (p.contact ?? {}) as Json;
  const inboxId = Number(conversation.inboxId);
  const cwConversationId = Number(conversation.id);
  const phone = (contact.phone ?? contact.identifier) as string | undefined;
  if (!Number.isFinite(inboxId) || !Number.isFinite(cwConversationId)) {
    return deny("no_conversation");
  }

  try {
    const db = admin();
    const { data: channel } = await db.from("channels").select("id")
      .eq("chatwoot_inbox_id", inboxId).maybeSingle();
    if (!channel?.id) return deny("no_channel");

    // Bot calado à mão (label bot-off) silencia também a IA — é o mesmo gate do
    // determinístico (ver bot-mute.ts / startBotMuteLoop).
    if (phone && await isBotMutedForContact(db, String(channel.id), phone)) {
      return deny("bot_off");
    }

    // A lane é a label no Chatwoot (fonte da verdade, visível pro operador).
    const acct = await accountForChannel(String(channel.id));
    const labels = await getConversationLabels(cwConversationId, acct);
    if (!hasAiLaneLabel(labels)) return deny("not_in_ai_lane");

    return allow();
  } catch (e) {
    // Erro → 500. O fazer.ai conta como ERRO (fail-closed): não responde e avisa o
    // operador. Preferimos silêncio a liberar/negar errado numa falha transitória.
    console.error("ai-gate erro:", e);
    return new Response("error", { status: 500 });
  }
}
