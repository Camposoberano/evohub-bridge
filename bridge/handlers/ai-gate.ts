// ai-gate — endpoint do contactAuth do fazer.ai. O agente "Vendedor Agro" consulta
// aqui ANTES de cada resposta. Política (invertida em 2026-11-17): LIBERA por padrão e
// nega só em dois casos — bot calado à mão (`bot-off`) ou lead em funil de 7 dias
// rodando (o funil é dono). A label `ai-vendas` deixou de ser pré-requisito: na prática
// quase nenhuma conversa a tinha, e exigir a lane calava o agente em ~todas. O fazer.ai
// é fail-closed, então negar = nenhum turno.
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
import { MEGA_SORGO_7D_VERSION } from "../shared/mega-sorgo-7d-content.ts";

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

    // Lead em funil de 7 dias: o funil é dono da conversa (abre, nutre, fecha). O agente
    // não entra enquanto a sequência está "running" — volta sozinho quando ela sai de running
    // (terminou/pausou/cancelou).
    const { data: seq7d } = await db.from("sales_sequences").select("status")
      .eq("chatwoot_conversation_id", cwConversationId)
      .eq("funnel", MEGA_SORGO_7D_VERSION).eq("status", "running").maybeSingle();
    if (seq7d) return deny("em_funil_7d");

    // Fora desses dois bloqueios, o agente responde (gate invertido — ver cabeçalho).
    return allow();
  } catch (e) {
    // Erro → 500. O fazer.ai conta como ERRO (fail-closed): não responde e avisa o
    // operador. Preferimos silêncio a liberar/negar errado numa falha transitória.
    console.error("ai-gate erro:", e);
    return new Response("error", { status: 500 });
  }
}
