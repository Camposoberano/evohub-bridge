export function commentReplyPath(
  externalContactId: string,
  commentId: string,
): string {
  if (externalContactId.startsWith("cmt-fb-")) {
    return `${commentId}/comments`;
  }
  if (externalContactId.startsWith("cmt-ig-")) {
    return `${commentId}/replies`;
  }
  throw new Error("contato não pertence a comentário Facebook/Instagram");
}

type Json = Record<string, unknown>;

export type SocialCommentInbound = {
  from: string;
  name: string;
  commentId: string;
  content: string;
  text: string;
  sentAt?: string;
};

export function commentContactExternalId(
  platform: "fb" | "ig",
  identity: string,
  commentId: string,
): string {
  const safeIdentity = identity.trim() || "anon";
  return `cmt-${platform}-${safeIdentity}-${commentId}`;
}

export function withMetaCursor(path: string, after: string): string {
  const url = new URL(path, "https://graph.invalid/");
  url.searchParams.set("after", after);
  return `${url.pathname.replace(/^\//, "")}${url.search}`;
}

export function parseSocialCommentChanges(
  object: string,
  entry: Json,
  channel: Json,
): SocialCommentInbound[] {
  const out: SocialCommentInbound[] = [];
  for (const change of (entry.changes ?? []) as Json[]) {
    const field = String(change.field ?? "");
    const value = (change.value ?? {}) as Json;

    if (
      object === "page" && field === "feed" && value.item === "comment" &&
      value.verb === "add"
    ) {
      const from = (value.from ?? {}) as Json;
      const senderId = String(value.sender_id ?? from.id ?? "");
      const commentId = String(value.comment_id ?? value.id ?? "");
      if (
        !senderId || !commentId || senderId === String(channel.page_id ?? "")
      ) continue;
      const senderName = String(
        value.sender_name ?? from.name ?? "Comentário FB",
      );
      out.push({
        from: commentContactExternalId("fb", senderId, commentId),
        name: `💬 ${senderName}`,
        commentId,
        text: String(value.message ?? ""),
        content: `💬 ${senderName} comentou:\n\n${
          String(value.message ?? "[sem texto]")
        }`,
        sentAt: timestamp(value.created_time),
      });
    }

    if (object === "instagram" && field === "comments") {
      const from = (value.from ?? {}) as Json;
      const senderId = String(from.id ?? value.user_id ?? "");
      const username = String(from.username ?? value.username ?? "");
      const commentId = String(value.id ?? value.comment_id ?? "");
      if (
        !commentId || (!senderId && !username) ||
        senderId === String(channel.ig_id ?? "")
      ) continue;
      const identity = username || senderId;
      out.push({
        from: commentContactExternalId("ig", identity, commentId),
        name: `💬 @${username || "anônimo"}`,
        commentId,
        text: String(value.text ?? ""),
        content: `💬 @${username || "anônimo"} comentou:\n\n${
          String(value.text ?? "[sem texto]")
        }`,
        sentAt: timestamp(value.timestamp),
      });
    }
  }
  return out;
}

function timestamp(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000)
      .toISOString();
  }
  return undefined;
}
