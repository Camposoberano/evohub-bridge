// funil-control — controle manual do funil (pause/stop/resume/status/dispatch).
// Chamado por macros do Chatwoot ou API direta.
// Auth: ?token=<CHATWOOT_WEBHOOK_SECRET>.
import { admin, claimDelivery, releaseDelivery } from "../shared/supabase.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { env } from "../shared/env.ts";
import {
  createConversationMessage,
  type CwAcct,
  getConversationLabels,
  setConversationLabels,
} from "../shared/chatwoot.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { handleMenuClick } from "./hub-webhook.ts";
import { handle as sendOutbound } from "./send-outbound.ts";
import { recoveryPieces } from "../shared/recovery-content.ts";
import { sendRecoveryTemplate } from "../shared/recovery-template.ts";
import { windowState } from "../shared/window.ts";
import { isMetaThreadControlError } from "../shared/meta-errors.ts";
import { autoPauseFunil } from "../shared/funnel-state.ts";
import { resumeSequenceRebased } from "../shared/funnel-recovery.ts";
import { leaveCatalogJourney, sendCatalogRootMenu } from "./catalog.ts";
import { blockContact } from "../shared/lead-block.ts";

export { autoPauseFunil } from "../shared/funnel-state.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  if (!timingSafeEqual(token, env("CHATWOOT_WEBHOOK_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as Json;
  const action = (body.action as string) ?? url.searchParams.get("action") ??
    "";
  // Aceita: chatwoot_conversation_id (API direta), conversation_id, id (webhook macro),
  // ou conversation.id (webhook Chatwoot aninhado)
  const conv_ = (body.conversation ?? {}) as Json;
  const cwConvId = Number(
    body.chatwoot_conversation_id ?? body.conversation_id ?? conv_.id ??
      body.id,
  );
  if (!cwConvId) {
    return json({ error: "chatwoot_conversation_id obrigatório" }, 400);
  }
  console.log("funil-control:", action, "conv", cwConvId);

  const db = admin();
  const { data: conv } = await db.from("conversations").select(
    "id, channel_id, contact_id, chatwoot_conversation_id",
  )
    .eq("chatwoot_conversation_id", cwConvId).maybeSingle();
  if (!conv) return json({ error: "conversa não encontrada" }, 404);

  const acct = await accountForChannel(conv.channel_id as string);

  if (action === "pause") {
    const { count: paused } = await db.from("scheduled_messages").update({
      status: "paused",
    })
      .eq("conversation_id", conv.id).eq("status", "pending")
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "paused" })
      .eq("conversation_id", conv.id).eq("status", "running");
    await db.from("events").insert({
      source: "funil",
      event_type: "manual_paused",
      payload: {
        conversation_id: conv.id,
        chatwoot_conversation_id: cwConvId,
        reason: "manual",
      },
    });
    await nota(
      cwConvId,
      `⏸️ *Funil pausado* — ${
        paused ?? 0
      } mensagens pendentes suspensas.\nPara retomar: macro "▶️ Retomar Funil".`,
      acct,
    );
    return json({ ok: true, action: "pause", paused: paused ?? 0 });
  }

  if (action === "stop") {
    const { count: cancelled } = await db.from("scheduled_messages").update({
      status: "cancelled",
    })
      .eq("conversation_id", conv.id).in("status", ["pending", "paused"])
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "cancelled" })
      .eq("conversation_id", conv.id).in("status", ["running", "paused"]);
    await nota(
      cwConvId,
      `⏹️ *Funil cancelado* — ${cancelled ?? 0} mensagens removidas da fila.`,
      acct,
    );
    return json({ ok: true, action: "stop", cancelled: cancelled ?? 0 });
  }

  // "pago" e "nao-compra" são etiquetas PERSISTENTES no Chatwoot (poll dedicado em
  // server.ts, startOutcomeLabelLoop -- diferente do poll de cmd-* que remove a etiqueta
  // depois de rodar). Cícero marca a etiqueta e ela fica visível como status permanente.
  if (action === "marcar-pago") {
    const { count: cancelled } = await db.from("scheduled_messages").update({
      status: "cancelled",
    })
      .eq("conversation_id", conv.id).in("status", ["pending", "paused"])
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "cancelled" })
      .eq("conversation_id", conv.id).in("status", ["running", "paused"]);
    await db.from("conversations").update({
      outcome: "won",
      outcome_source: "label",
      outcome_set_at: new Date().toISOString(),
    }).eq("id", conv.id);
    await nota(
      cwConvId,
      `✅ *Marcado como PAGO* — funil encerrado (${
        cancelled ?? 0
      } mensagens removidas da fila).`,
      acct,
    );
    return json({ ok: true, action: "marcar-pago", cancelled: cancelled ?? 0 });
  }

  if (action === "marcar-nao-compra") {
    const { count: cancelled } = await db.from("scheduled_messages").update({
      status: "cancelled",
    })
      .eq("conversation_id", conv.id).in("status", ["pending", "paused"])
      .select("id", { count: "exact", head: true });
    await db.from("sales_sequences").update({ status: "cancelled" })
      .eq("conversation_id", conv.id).in("status", ["running", "paused"]);
    await db.from("conversations").update({
      outcome: "lost",
      outcome_source: "label",
      outcome_set_at: new Date().toISOString(),
    }).eq("id", conv.id);
    if (conv.contact_id) {
      await blockContact(db, conv.contact_id as string, "nao-compra");
    }
    await nota(
      cwConvId,
      `🚫 *Marcado como NÃO COMPRA* — funil encerrado (${
        cancelled ?? 0
      } mensagens removidas da fila) e contato bloqueado pra futuros funis.`,
      acct,
    );
    return json({
      ok: true,
      action: "marcar-nao-compra",
      cancelled: cancelled ?? 0,
    });
  }

  if (action === "resume") {
    // Reprograma em vez de só devolver pra 'pending': as peças pausadas ficaram com
    // send_at no passado, e o pump considera vencida toda linha com send_at <= agora —
    // um funil parado por dias despejaria o resto do roteiro no cliente em minutos.
    // resumeSequenceRebased preserva os intervalos e reancora em agora+60s; é a mesma
    // função que o auto-resume usa, pra não voltarem a divergir.
    const resumed = await resumeSequenceRebased(db, String(conv.id));
    await db.from("events").insert({
      source: "funil",
      event_type: "manual_resumed",
      payload: {
        conversation_id: conv.id,
        chatwoot_conversation_id: cwConvId,
        resumed_messages: resumed,
      },
    });
    await nota(
      cwConvId,
      resumed > 0
        ? `▶️ *Funil retomado* — ${resumed} mensagens reativadas, reagendadas a partir de agora mantendo os intervalos originais.`
        : "▶️ *Nada a retomar* — não há mensagem pausada nesta conversa. (Se o funil foi encerrado por *stop*, *pago* ou *não compra*, as mensagens foram canceladas e só um novo início traz de volta.)",
      acct,
    );
    return json({ ok: true, action: "resume", resumed });
  }

  if (action === "status") {
    const { data: seq, error: seqError } = await db.from("sales_sequences")
      .select("funnel, status")
      .eq("conversation_id", conv.id).limit(1).maybeSingle();
    const { count: pending, error: pendingError } = await db.from(
      "scheduled_messages",
    ).select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("status", "pending");
    const { count: paused, error: pausedError } = await db.from(
      "scheduled_messages",
    ).select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("status", "paused");
    const { count: sent, error: sentError } = await db.from(
      "scheduled_messages",
    ).select("id", { count: "exact", head: true })
      .eq("conversation_id", conv.id).eq("status", "sent");
    const { data: next, error: nextError } = await db.from("scheduled_messages")
      .select("id, type, send_at, status").eq("conversation_id", conv.id)
      .in("status", ["pending", "paused"]).order("send_at", { ascending: true })
      .limit(1).maybeSingle();
    const { data: upcoming, error: upcomingError } = await db.from(
      "scheduled_messages",
    )
      .select("day, step, type, send_at, status").eq("conversation_id", conv.id)
      .order("send_at", { ascending: true }).limit(40);
    const { data: mediaRows, error: mediaError } = await db.from("funnel_media")
      .select("day, slot, type").eq("funnel", "mega-sorgo").eq("active", true);
    const media = (mediaRows ?? []).reduce(
      (acc: Record<string, number>, row: Json) => {
        const key = `dia${row.day}:${row.slot}:${row.type ?? "unknown"}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {},
    );
    return json({
      ok: true,
      funnel: seq?.funnel ?? null,
      sequence_status: seq?.status ?? null,
      pending: pending ?? 0,
      paused: paused ?? 0,
      sent: sent ?? 0,
      next: next ?? null,
      upcoming: upcoming ?? [],
      media,
      diagnostics: [
        seqError,
        pendingError,
        pausedError,
        sentError,
        nextError,
        upcomingError,
        mediaError,
      ]
        .filter(Boolean).map((e) => e?.message),
    });
  }

  // Iniciar funil de apresentação (Mega Sorgo) manualmente
  if (action === "funil" || action === "iniciar" || action === "start-funil") {
    const secret = env("CHATWOOT_WEBHOOK_SECRET");
    const enrollRes = await fetch(
      `http://localhost:${Deno.env.get("PORT") ?? "8000"}/funil-enroll?token=${
        encodeURIComponent(secret)
      }`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Clique manual começa imediatamente; as fases seguintes respeitam a cadência comercial.
        body: JSON.stringify({
          chatwoot_conversation_id: cwConvId,
          force: true,
          manual: true,
        }),
      },
    );
    const enrollData = await enrollRes.json().catch(() => ({})) as Json;
    if (enrollData.ok) {
      await nota(
        cwConvId,
        `🚀 *Funil de apresentação iniciado!*\n${
          enrollData.enfileiradas ?? 0
        } mensagens enfileiradas.`,
        acct,
      );
      return json({
        ok: true,
        action: "funil",
        enfileiradas: enrollData.enfileiradas,
      });
    }
    return json({
      ok: false,
      action: "funil",
      error: enrollData.error ?? "erro ao iniciar funil",
    }, 500);
  }

  if (action === "catalogo" || action === "abrir-catalogo") {
    const resolved = await resolveChannelAndContact(db, conv);
    if (!resolved) {
      return json({ error: "canal ou contato não encontrado" }, 404);
    }
    await sendCatalogRootMenu(
      db,
      resolved.channel,
      resolved.from,
      acct,
      "catalogo_manual",
    );
    await nota(
      cwConvId,
      "🛒 *Catálogo aberto manualmente.* O funil Mega Sorgo foi pausado para não misturar as jornadas.",
      acct,
    );
    return json({ ok: true, action: "catalogo", journey: "catalogo" });
  }

  if (action === "catalogo-sair" || action === "voltar-mega-sorgo") {
    const resolved = await resolveChannelAndContact(db, conv);
    if (!resolved) {
      return json({ error: "canal ou contato não encontrado" }, 404);
    }
    await leaveCatalogJourney(db, resolved.channel, resolved.from, acct);
    await nota(
      cwConvId,
      "↩️ *Catálogo encerrado.* A conversa voltou ao contexto Mega Sorgo. O funil permanece pausado até uma retomada manual.",
      acct,
    );
    return json({
      ok: true,
      action: "catalogo-sair",
      journey: "mega_sorgo",
    });
  }

  const recoveryMatch = action.match(/^recuperacao-([1-4])$/);
  if (recoveryMatch) {
    return await dispatchRecovery(
      db,
      conv as Json,
      cwConvId,
      Number(recoveryMatch[1]),
      acct,
    );
  }

  // Dispatch: dispara sequência de intent manualmente (preço, vídeo, plantio, nutrição)
  const DISPATCH_MAP: Record<string, string> = {
    preco: "menu_preco",
    price: "menu_preco",
    video: "menu_depoimento",
    videos: "menu_depoimento",
    depoimento: "menu_depoimento",
    plantio: "menu_plantio",
    adubacao: "menu_plantio",
    nutricao: "menu_nutricao",
    nutricional: "menu_nutricao",
  };
  const menuId = DISPATCH_MAP[action];
  if (menuId) {
    const resolved = await resolveChannelAndContact(db, conv);
    if (!resolved) {
      return json({ error: "canal ou contato não encontrado" }, 404);
    }
    try {
      // Uma sequencia comercial manual substitui a conversa automatica naquele
      // momento. Pausa o funil principal antes de enviar para nao misturar
      // preco, audios e videos de jornadas diferentes.
      const funnelPaused = await autoPauseFunil(
        String(conv.id),
        `macro manual: ${action}`,
      );
      const dispatch = await handleMenuClick(
        db,
        resolved.channel,
        resolved.from,
        menuId,
        acct,
      );
      if (!dispatch.sent && dispatch.reason === "already-sent-today") {
        await nota(
          cwConvId,
          `ℹ️ *Sequência "${action}" não repetida* — este conteúdo já foi enviado hoje.`,
          acct,
        );
        return json({ ok: true, action, skipped: "already-sent-today" });
      }
      if (!dispatch.sent) throw new Error("sequência não confirmou envio");
      await nota(
        cwConvId,
        `🚀 *Sequência "${action}" disparada manualmente via ${
          deliveryChannelLabel(resolved.channel)
        }.*`,
        acct,
      );
      return json({
        ok: true,
        action,
        dispatched: menuId,
        channel: deliveryChannelLabel(resolved.channel),
        funnel_paused: funnelPaused,
      });
    } catch (e) {
      const detail = String(e).slice(0, 240);
      if (isMetaThreadControlError(detail)) {
        await nota(
          cwConvId,
          "🚫 *Funil não enviado:* outro aplicativo está controlando esta conversa na Meta. Ajuste o receptor principal da Página para Evolution Foundation/EvoHub e execute a macro novamente.",
          acct,
        );
        return json({
          ok: false,
          terminal: true,
          blocked: "meta-thread-control",
          error: detail,
        }, 409);
      }
      return json({ error: detail }, 500);
    }
  }

  return json({
    error: "ação desconhecida: " + action +
      " (use: funil, pause, stop, resume, status, catalogo, catalogo-sair, preco, video, plantio, nutricao, recuperacao-1..4)",
  }, 400);
}

// Exportada porque a cadeia automática (shared/recovery-chain.ts) dispara pelo mesmo
// caminho da macro manual — mesmo claimDelivery, mesmas etiquetas, mesmo evento. Duas
// implementações de "mandar recuperação" divergiriam na primeira mudança.
export async function dispatchRecovery(
  db: Db,
  conv: Json,
  cwConvId: number,
  variation: number,
  acct: CwAcct,
): Promise<Response> {
  const resolved = await resolveChannelAndContact(db, conv);
  if (!resolved) {
    return json({ error: "canal ou contato não encontrado" }, 404);
  }
  const channel = deliveryChannelLabel(resolved.channel);
  const claimKey = `recovery-${conv.id}-${variation}`;
  if (!await claimDelivery(db, claimKey, "recovery")) {
    await nota(
      cwConvId,
      `ℹ️ *Recuperação ${variation} não repetida* — esta variação já foi enviada para o contato via ${channel}.`,
      acct,
    );
    return json({
      ok: true,
      action: `recuperacao-${variation}`,
      skipped: "already-sent",
      channel,
    });
  }

  try {
    // Janela fechada (canal oficial): texto livre seria rejeitado pela Meta. Manda o
    // template aprovado, que tem botões — o toque do lead reabre a janela e aí a próxima
    // recuperação já entra com o conteúdo rico. Ver shared/recovery-template.ts.
    const win = await windowState(db, conv, resolved.channel);
    if (!win.aberta) {
      const sent = await sendRecoveryTemplate(
        db,
        resolved.channel,
        resolved.from,
        variation,
      );
      if (!sent.ok) throw new Error(`template ${sent.template}: ${sent.error}`);

      const labelsFechada = await getConversationLabels(cwConvId, acct);
      await setConversationLabels(
        cwConvId,
        [
          ...new Set([
            ...labelsFechada.filter((label) =>
              label !== "recuperacao-respondeu"
            ),
            `recuperacao-${variation}-enviada`,
            "recuperacao-aguardando",
          ]),
        ],
        acct,
      );
      await db.from("events").insert({
        source: "recovery",
        event_type: "recovery_sent",
        payload: {
          conversation_id: conv.id,
          chatwoot_conversation_id: cwConvId,
          variation,
          channel,
          via: "template",
          template: sent.template,
          janela: win.tipo,
        },
      });
      await nota(
        cwConvId,
        `✅ *Recuperação ${variation} enviada por TEMPLATE* (${sent.template}) — a janela ${win.tipo} estava fechada. Quando o cliente tocar num botão a janela reabre e o conteúdo completo pode ser enviado.`,
        acct,
      );
      return json({
        ok: true,
        action: `recuperacao-${variation}`,
        channel,
        via: "template",
        template: sent.template,
      });
    }

    const media = await recoveryMedia(db, variation);
    const pieces = recoveryPieces(variation, media);
    for (const piece of pieces) {
      const response = await sendOutbound(
        new Request(
          `http://internal/send-outbound?token=${
            encodeURIComponent(env("CHATWOOT_WEBHOOK_SECRET"))
          }`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chatwoot_conversation_id: cwConvId,
              type: piece.type,
              payload: piece.payload,
            }),
          },
        ),
      );
      const result = await response.json().catch(() => ({})) as Json;
      if (!response.ok || result.ok === false || result.blocked) {
        throw new Error(
          String(result.error ?? result.blocked ?? `envio ${response.status}`),
        );
      }
    }

    const labels = await getConversationLabels(cwConvId, acct);
    await setConversationLabels(
      cwConvId,
      [
        ...new Set([
          ...labels.filter((label) => label !== "recuperacao-respondeu"),
          `recuperacao-${variation}-enviada`,
          "recuperacao-aguardando",
        ]),
      ],
      acct,
    );
    await db.from("events").insert({
      source: "recovery",
      event_type: "recovery_sent",
      payload: {
        conversation_id: conv.id,
        chatwoot_conversation_id: cwConvId,
        variation,
        channel,
        pieces: pieces.map((piece) => piece.type),
      },
    });
    await nota(
      cwConvId,
      `✅ *Recuperação ${variation} enviada via ${channel}* — aguardando resposta do cliente.`,
      acct,
    );
    return json({
      ok: true,
      action: `recuperacao-${variation}`,
      channel,
      pieces: pieces.map((piece) => piece.type),
    });
  } catch (error) {
    await releaseDelivery(db, claimKey);
    return json({
      ok: false,
      action: `recuperacao-${variation}`,
      error: String(error).slice(0, 240),
    }, 500);
  }
}

async function recoveryMedia(
  db: Db,
  variation: number,
): Promise<{ image?: string; video?: string; audio?: string }> {
  const spec = variation === 1
    ? { day: 1, slot: "image", type: "image" }
    : variation === 2
    ? { day: 3, slot: "video", type: "video" }
    : variation === 3
    ? { day: 4, slot: "audio1", type: "audio" }
    : { day: 5, slot: "image", type: "image" };
  const { data, error } = await db.from("funnel_media").select("url")
    .eq("funnel", "mega-sorgo").eq("active", true)
    .eq("day", spec.day).eq("slot", spec.slot).eq("type", spec.type)
    .limit(50);
  if (error) throw error;
  const rows = (data ?? []) as Json[];
  const picked = rows.length
    ? rows[Math.floor(Math.random() * rows.length)]
    : null;
  if (!picked?.url) return {};
  return { [spec.type]: String(picked.url) };
}

async function resolveChannelAndContact(
  db: Db,
  conv: Json,
): Promise<{ channel: Json; from: string } | null> {
  const { data: channel } = await db.from("channels").select("*")
    .eq("id", conv.channel_id).maybeSingle();
  if (!channel) return null;
  const { data: contact } = await db.from("contacts").select(
    "external_contact_id",
  )
    .eq("id", conv.contact_id).maybeSingle();
  if (!contact?.external_contact_id) return null;
  return {
    channel: channel as Json,
    from: contact.external_contact_id as string,
  };
}

function deliveryChannelLabel(channel: Json): string {
  if (channel.type === "instagram") return "Instagram";
  if (channel.type === "facebook") return "Facebook";
  return "WhatsApp";
}

async function nota(cwConvId: number, text: string, acct: CwAcct) {
  try {
    await createConversationMessage(cwConvId, {
      content: text,
      messageType: "outgoing",
      private: true,
    }, acct);
  } catch (e) {
    console.warn("funil-control nota falhou:", String(e).slice(0, 120));
  }
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
