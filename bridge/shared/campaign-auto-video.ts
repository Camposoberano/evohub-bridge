// Vídeo das quatro reativações para quem não respondeu à abertura.
// Um envio confirmado por número a cada dez minutos, somente na janela da campanha.
import type { DbClient } from "./supabase.ts";
import { claimDelivery, publicTable } from "./supabase.ts";
import { type Campaign, readCampaigns } from "./campaigns.ts";
import { dentroDaJanela, PACE_PADRAO } from "./campaign-pace.ts";
import { bloqueioPorContato } from "./gate-comercial.ts";
import { isBotMutedForContact } from "./bot-mute.ts";
import { gravadorDeFluxo } from "./flow-record.ts";
import { accountForChannel } from "./accounts.ts";
import {
  claimFlowStep,
  saveFlowPosition,
  setClaimedFlowStatus,
} from "./flow-state.ts";
import {
  type HybridRoute,
  hybridSendMedia,
  isHybridRecipient,
} from "./hybrid.ts";
import { listInstances } from "./uazapi.ts";

type Json = Record<string, unknown>;
const GROUPS = [
  ["reativacao-5895-of", "reativacao-5895-uz"],
  ["reativacao-6836-uz"],
  ["reativacao-0595-uz"],
] as const;
const GAP_MS = 10 * 60_000;
const MINUTE_MS = 60_000;
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

export function autoVideoDue(
  campaign: Campaign,
  waitingSince: string | null,
  now: number,
): boolean {
  const minutes = Number(campaign.autoVideoAfterMin);
  return Number.isFinite(minutes) && minutes >= 5 && !!waitingSince &&
    now - Date.parse(waitingSince) >= minutes * MINUTE_MS &&
    dentroDaJanela({ ...PACE_PADRAO, ...(campaign.pace ?? {}) }, now);
}

export async function pumpCampaignAutoVideos(
  db: DbClient,
  now = Date.now(),
): Promise<{ sent: number; blocked: number; failed: number }> {
  const result = { sent: 0, blocked: 0, failed: 0 };
  const state = await readCampaigns();
  const instances = await listInstances();
  for (const ids of GROUPS) {
    const campaigns = ids.map((id) => state.campaigns.find((c) => c.id === id))
      .filter((c): c is Campaign => !!c && Number(c.autoVideoAfterMin) >= 5);
    if (!campaigns.length) continue;
    const cutoff = new Date(
      now -
        Math.min(...campaigns.map((c) => Number(c.autoVideoAfterMin))) *
          MINUTE_MS,
    ).toISOString();
    const { data: candidates, error } = await publicTable(
      db,
      "campaign_flow_state",
    )
      .select(
        "campaign_id,contact_key,conversation_id,channel_id,waiting_since",
      )
      .in("campaign_id", campaigns.map((c) => c.id))
      .eq("step_id", "abertura").eq("status", "waiting")
      .lte("waiting_since", cutoff)
      .order("waiting_since", { ascending: true }).limit(10);
    if (error) throw error;
    const item = (candidates ?? []).find((row: Json) => {
      const campaign = campaigns.find((c) => c.id === row.campaign_id);
      return campaign &&
        autoVideoDue(campaign, String(row.waiting_since ?? ""), now);
    }) as Json | undefined;
    if (!item) continue;
    const campaign = campaigns.find((c) => c.id === item.campaign_id)!;
    const video = campaign.flow?.steps.find((s) => s.id === "video");
    if (
      video?.kind !== "media" || video.media?.type !== "video" ||
      !video.media.url || !isHybridRecipient(String(item.contact_key))
    ) {
      if (
        await claimFlowStep(
          db,
          campaign.id,
          String(item.contact_key),
          "abertura",
        )
      ) {
        await setClaimedFlowStatus(
          db,
          campaign.id,
          String(item.contact_key),
          "abertura",
          "failed",
        );
      }
      result.blocked++;
      continue;
    }
    const { data: channel, error: channelError } = await db.from("channels")
      .select(
        "id,type,name,phone_number,phone_number_id,chatwoot_inbox_id,chatwoot_inbox_identifier",
      )
      .eq("id", item.channel_id).maybeSingle();
    if (channelError) throw channelError;
    const instance = instances.find((candidate) =>
      candidate.status === "connected" &&
      digits(candidate.number) === digits(channel?.phone_number)
    );
    if (!channel) {
      if (
        await claimFlowStep(
          db,
          campaign.id,
          String(item.contact_key),
          "abertura",
        )
      ) {
        await setClaimedFlowStatus(
          db,
          campaign.id,
          String(item.contact_key),
          "abertura",
          "failed",
        );
      }
      result.blocked++;
      continue;
    }
    if (!instance?.token) {
      result.blocked++;
      continue;
    }
    if (
      await bloqueioPorContato(
        db,
        String(channel.id),
        String(item.contact_key),
      ) ||
      await isBotMutedForContact(
        db,
        String(channel.id),
        String(item.contact_key),
      )
    ) {
      if (
        await claimFlowStep(
          db,
          campaign.id,
          String(item.contact_key),
          "abertura",
        )
      ) {
        await saveFlowPosition(db, campaign.id, String(item.contact_key), {
          stepId: null,
          done: true,
        }, {
          conversationId: String(item.conversation_id ?? "") || null,
          channelId: String(channel.id),
        });
      }
      result.blocked++;
      continue;
    }
    const slot = Math.floor(now / GAP_MS);
    const claim = `campaign-auto-video:${digits(channel.phone_number)}:${slot}`;
    if (!await claimDelivery(db, claim, "campaign-auto-video")) continue;
    if (
      !await claimFlowStep(
        db,
        campaign.id,
        String(item.contact_key),
        "abertura",
      )
    ) continue;
    const route: HybridRoute = {
      provider: "uazapi",
      instance: instance.name,
      token: instance.token,
      channelId: String(channel.id),
    };
    try {
      const sent = await hybridSendMedia(
        route,
        String(item.contact_key),
        video.media.url,
        "video",
        {
          caption: video.text,
          asyncReceipt: {
            trackId: crypto.randomUUID(),
            trackSource: "evohub-reactivation-video",
            startedAt: Date.now(),
            maxWaitMs: 60_000,
          },
        },
      );
      if (!sent?.ok) throw new Error("provedor rejeitou o vídeo");
      try {
        await gravadorDeFluxo(
          db,
          channel as Json,
          String(item.contact_key),
          await accountForChannel(String(channel.id)),
        )(
          video,
        );
      } catch (error) {
        console.error(
          "campaign-auto-video: vídeo confirmado, registro da conversa falhou",
          campaign.id,
          String(item.contact_key).slice(-4),
          error instanceof Error ? error.message : String(error),
        );
      }
      await saveFlowPosition(db, campaign.id, String(item.contact_key), {
        stepId: "video",
        waitingSince: new Date().toISOString(),
      }, {
        conversationId: String(item.conversation_id ?? "") || null,
        channelId: String(channel.id),
      });
      result.sent++;
      console.log(
        "campaign-auto-video: confirmado",
        campaign.id,
        String(item.contact_key).slice(-4),
      );
    } catch (cause) {
      await setClaimedFlowStatus(
        db,
        campaign.id,
        String(item.contact_key),
        "abertura",
        "failed",
      );
      result.failed++;
      console.error(
        "campaign-auto-video: sem confirmação; revisão manual",
        campaign.id,
        String(item.contact_key).slice(-4),
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }
  return result;
}
