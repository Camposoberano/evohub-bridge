import { capDoDia, dentroDaJanela, type PaceConfig } from "./campaign-pace.ts";

export const ROTATION_GROUPS = [
  { number: "5895", campaigns: ["reativacao-5895-of", "reativacao-5895-uz"] },
  { number: "0595", campaigns: ["reativacao-0595-uz"] },
  { number: "6836", campaigns: ["reativacao-6836-uz"] },
] as const;

export const ROTATION_CAMPAIGNS = ROTATION_GROUPS.flatMap((
  group,
) => [...group.campaigns]);

export type CampaignRotationSnapshot = {
  campaignId: string;
  pending: number;
  sentToday: number;
  lastSentAt: number | null;
  createdAt: number;
  pace: PaceConfig;
};

export type RotationDecision = {
  campaignId: string;
  number: string;
  cap: number;
  sentToday: number;
  gapMs: number;
} | null;

/** Distribui os envios restantes até o fim da janela, um contato por vez. */
export function chooseCampaignRotation(
  snapshots: CampaignRotationSnapshot[],
  now: number,
): RotationDecision {
  const byId = new Map(snapshots.map((item) => [item.campaignId, item]));
  const groups = ROTATION_GROUPS.flatMap((group) => {
    const campaigns = group.campaigns.map((id) => byId.get(id)).filter((c) =>
      c !== undefined
    );
    if (campaigns.length !== group.campaigns.length) return [];
    const eligible = campaigns.map((campaign) => {
      const cap = capDoDia(campaign.pace, campaign.createdAt, now);
      return {
        campaign,
        cap,
        remaining: dentroDaJanela(campaign.pace, now)
          ? Math.min(Math.max(0, cap - campaign.sentToday), campaign.pending)
          : 0,
      };
    });
    const cap = eligible.reduce((sum, item) => sum + item.cap, 0);
    const sentToday = campaigns.reduce((sum, c) => sum + c.sentToday, 0);
    const remaining = eligible.reduce((sum, item) => sum + item.remaining, 0);
    if (!remaining) return [];
    return [{
      number: group.number,
      campaigns: eligible.filter((item) => item.remaining > 0),
      cap,
      sentToday,
      remaining,
      endHour: Math.min(
        ...eligible.filter((item) => item.remaining > 0).map((item) =>
          item.campaign.pace.horaFim
        ),
      ),
    }];
  });
  if (!groups.length) return null;

  const lastSentAt = Math.max(
    0,
    ...snapshots.map((item) => item.lastSentAt ?? 0),
  );
  const remainingTotal = groups.reduce(
    (sum, group) => sum + group.remaining,
    0,
  );
  const brtDayStart =
    Math.floor((now - 3 * 60 * 60_000) / 86_400_000) * 86_400_000 +
    3 * 60 * 60_000;
  const endAt = Math.min(
    ...groups.map((group) => brtDayStart + group.endHour * 60 * 60_000),
  );
  const gapMs = Math.max(60_000, Math.floor((endAt - now) / remainingTotal));
  if (lastSentAt && now - lastSentAt < gapMs) return null;

  groups.sort((a, b) =>
    a.sentToday / a.cap - b.sentToday / b.cap ||
    Math.max(0, ...a.campaigns.map((item) => item.campaign.lastSentAt ?? 0)) -
      Math.max(0, ...b.campaigns.map((item) => item.campaign.lastSentAt ?? 0))
  );
  const selected = groups[0];
  const campaigns = selected.campaigns;
  campaigns.sort((a, b) =>
    a.campaign.sentToday / a.cap - b.campaign.sentToday / b.cap ||
    (a.campaign.lastSentAt ?? 0) - (b.campaign.lastSentAt ?? 0)
  );
  return {
    campaignId: campaigns[0].campaign.campaignId,
    number: selected.number,
    cap: selected.cap,
    sentToday: selected.sentToday,
    gapMs,
  };
}
