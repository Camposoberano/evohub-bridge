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
    const primary = campaigns[0];
    if (!dentroDaJanela(primary.pace, now)) return [];
    const cap = capDoDia(primary.pace, primary.createdAt, now);
    const sentToday = campaigns.reduce((sum, c) => sum + c.sentToday, 0);
    const pending = campaigns.reduce((sum, c) => sum + c.pending, 0);
    const remaining = Math.min(Math.max(0, cap - sentToday), pending);
    if (!remaining) return [];
    return [{
      number: group.number,
      campaigns,
      cap,
      sentToday,
      remaining,
      endHour: primary.pace.horaFim,
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
    Math.max(0, ...a.campaigns.map((c) => c.lastSentAt ?? 0)) -
      Math.max(0, ...b.campaigns.map((c) => c.lastSentAt ?? 0))
  );
  const selected = groups[0];
  const campaigns = selected.campaigns.filter((c) => c.pending > 0);
  campaigns.sort((a, b) =>
    a.sentToday - b.sentToday || (a.lastSentAt ?? 0) - (b.lastSentAt ?? 0)
  );
  return {
    campaignId: campaigns[0].campaignId,
    number: selected.number,
    cap: selected.cap,
    sentToday: selected.sentToday,
    gapMs,
  };
}
