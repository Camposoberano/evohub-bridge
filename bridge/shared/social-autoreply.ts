import { sendMeta } from "./hub.ts";
import {
  admin,
  claimDelivery,
  type DbClient,
  releaseDelivery,
} from "./supabase.ts";
import { commentReplyPath } from "./social.ts";

const BUCKET = "soberano-config";
const FILE = "social-comment-autoreplies.json";
const TTL_MS = 30_000;

type Platform = "facebook" | "instagram";
type Json = Record<string, unknown>;

export type SocialAutoReplyRule = {
  id: string;
  enabled: boolean;
  channels?: Platform[];
  channelIds?: string[];
  keywords: string[];
  reply: string;
};

export type SocialAutoReplyConfig = { rules: SocialAutoReplyRule[] };

export type SocialAutoReplyComment = {
  from: string;
  commentId: string;
  text: string;
};

const DEFAULT_CONFIG: SocialAutoReplyConfig = {
  rules: [{
    id: "silagem",
    enabled: false,
    channels: ["facebook", "instagram"],
    keywords: ["silagem", "cilagem"],
    reply: "",
  }],
};

let cached: SocialAutoReplyConfig | null = null;
let cachedAt = 0;

export function normalizeSocialText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
}

export function matchSocialAutoReply(
  config: SocialAutoReplyConfig,
  platform: Platform,
  channelId: string,
  text: string,
): SocialAutoReplyRule | null {
  const normalized = normalizeSocialText(text);
  if (!normalized) return null;
  return config.rules.find((rule) => {
    if (!rule.enabled || !rule.reply?.trim()) return false;
    if (rule.channels?.length && !rule.channels.includes(platform)) {
      return false;
    }
    if (rule.channelIds?.length && !rule.channelIds.includes(channelId)) {
      return false;
    }
    return rule.keywords.some((keyword) => {
      const term = normalizeSocialText(keyword);
      return term.length > 0 && normalized.includes(term);
    });
  }) ?? null;
}

export async function readSocialAutoReplyConfig(
  force = false,
): Promise<SocialAutoReplyConfig> {
  if (!force && cached && Date.now() - cachedAt < TTL_MS) return cached;
  try {
    const { data } = await admin().storage.from(BUCKET).download(FILE);
    if (data) {
      const parsed = JSON.parse(await data.text()) as SocialAutoReplyConfig;
      cached = { rules: Array.isArray(parsed.rules) ? parsed.rules : [] };
    } else cached = DEFAULT_CONFIG;
  } catch {
    cached = DEFAULT_CONFIG;
  }
  cachedAt = Date.now();
  return cached;
}

export async function maybeAutoReplySocialComment(
  db: DbClient,
  channel: Json,
  comment: SocialAutoReplyComment,
): Promise<"sent" | "disabled" | "duplicate" | "failed"> {
  const platform = channel.type === "facebook"
    ? "facebook"
    : channel.type === "instagram"
    ? "instagram"
    : null;
  if (!platform) return "disabled";

  const rule = matchSocialAutoReply(
    await readSocialAutoReplyConfig(),
    platform,
    String(channel.id ?? ""),
    comment.text,
  );
  if (!rule) return "disabled";

  const claimKey =
    `social-autoreply-${rule.id}-${platform}-${comment.commentId}`;
  if (!await claimDelivery(db, claimKey, "social-autoreply")) {
    return "duplicate";
  }

  try {
    const { data: secret, error } = await db.from("channel_secrets")
      .select("channel_token").eq("channel_id", channel.id).maybeSingle();
    if (error || !secret?.channel_token) {
      throw new Error("canal social sem token");
    }
    const response = await sendMeta(
      secret.channel_token,
      commentReplyPath(comment.from, comment.commentId),
      { message: rule.reply.trim() },
    );
    if (!response.ok) {
      throw new Error(
        `Meta ${response.status}: ${
          JSON.stringify(response.data).slice(0, 250)
        }`,
      );
    }
    await db.from("events").insert({
      source: "social-autoreply",
      event_type: "reply_sent",
      channel_id: channel.id,
      payload: { rule_id: rule.id, comment_id: comment.commentId, platform },
    });
    return "sent";
  } catch (error) {
    await releaseDelivery(db, claimKey).catch(() => {});
    await db.from("events").insert({
      source: "social-autoreply",
      event_type: "reply_failed",
      channel_id: channel.id,
      payload: {
        rule_id: rule.id,
        comment_id: comment.commentId,
        platform,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return "failed";
  }
}
