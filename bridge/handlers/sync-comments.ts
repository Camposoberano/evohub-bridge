// sync-comments — puxa COMENTÁRIOS de posts/anúncios (Facebook Pages + Instagram) via Graph
// e injeta no Chatwoot como conversa por comentador (Fase 1: só receber; responder pelo FB/IG).
// Meta não entrega webhook de comentário pelo Hub -> pull, igual ao sync-facebook das DMs.
// Contato = "cmt-fb-<user_id>" / "cmt-ig-<username>" (prefixo isola do PSID de Messenger:
// responder essas conversas pelo Chatwoot NÃO entrega — Fase 2). Dedup por comment id
// (meta_message_id). Auth: SYNC_SECRET|CHATWOOT_WEBHOOK_SECRET|RYZEAPI_WEBHOOK_TOKEN.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { getMeta } from "../shared/hub.ts";
import { ingestInbound } from "../shared/inbound.ts";
import { accountForChannel } from "../shared/accounts.ts";
import { commentContactExternalId, withMetaCursor } from "../shared/social.ts";
import { maybeAutoReplySocialComment } from "../shared/social-autoreply.ts";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof admin>;

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) return json({ error: "method not allowed" }, 405);
  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  const sinceMinutes = intParam(url, "since_minutes", 1440, 1, 10_080);
  const postLimit = intParam(url, "post_limit", 10, 1, 25);
  const commentLimit = intParam(url, "comment_limit", 25, 1, 100);
  const pageLimit = intParam(url, "page_limit", 3, 1, 5);
  const cutoffMs = Date.now() - sinceMinutes * 60_000;

  const db = admin();
  const { data: rawChannels, error: chErr } = await db.from("channels")
    .select("id,type,name,status,page_id,ig_id,chatwoot_inbox_identifier")
    .in("type", ["facebook", "instagram"]).eq("status", "active");
  if (chErr) return json({ error: chErr.message }, 500);
  const channels = (rawChannels ?? []).filter((c: Json) => (c.type === "instagram" ? c.ig_id : c.page_id));

  const totals = { channels: channels.length, posts_scanned: 0, comments_found: 0, inserted: 0, duplicates: 0, skipped_own: 0, errors: [] as string[] };

  for (const channel of channels) {
    try {
      const acct = await accountForChannel(channel.id as string);
      const r = channel.type === "instagram"
        ? await syncIgComments(db, channel as Json, { cutoffMs, postLimit, commentLimit, pageLimit }, acct)
        : await syncFbComments(db, channel as Json, { cutoffMs, postLimit, commentLimit, pageLimit }, acct);
      totals.posts_scanned += r.posts_scanned;
      totals.comments_found += r.comments_found;
      totals.inserted += r.inserted;
      totals.duplicates += r.duplicates;
      totals.skipped_own += r.skipped_own;
    } catch (e) {
      totals.errors.push(`${channel.name ?? channel.id}: ${msg(e)}`);
    }
  }

  if (totals.inserted > 0 || totals.errors.length > 0) {
    db.from("events").insert({ source: "sync-comments", event_type: "sync_completed", payload: { ...totals, since_minutes: sinceMinutes, page_limit: pageLimit } }).then(() => {}, () => {});
  }
  return json(totals);
}

type Opts = { cutoffMs: number; postLimit: number; commentLimit: number; pageLimit: number };
type Res = { posts_scanned: number; comments_found: number; inserted: number; duplicates: number; skipped_own: number };

async function channelToken(db: Db, channelId: string): Promise<string> {
  const { data, error } = await db.from("channel_secrets").select("channel_token").eq("channel_id", channelId).maybeSingle();
  if (error) throw error;
  if (!data?.channel_token) throw new Error("canal sem token");
  return data.channel_token as string;
}

// resumo do post pra dar contexto na mensagem (o atendente precisa saber ONDE comentaram).
function postRef(text: string | undefined, link: string | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const parts = [t ? `"${t}${t.length >= 60 ? "…" : ""}"` : "", link ?? ""].filter(Boolean);
  return parts.length ? ` no post ${parts.join(" — ")}` : "";
}

async function syncFbComments(
  db: Db,
  channel: Json,
  opts: Opts,
  acct: Awaited<ReturnType<typeof accountForChannel>>,
): Promise<Res> {
  const pageId = channel.page_id as string;
  const token = await channelToken(db, channel.id as string);
  const res: Res = { posts_scanned: 0, comments_found: 0, inserted: 0, duplicates: 0, skipped_own: 0 };

  const posts = await getMetaCollection(
    token,
    `${pageId}/feed?fields=id,message,updated_time,permalink_url&limit=${opts.postLimit}`,
    opts.pageLimit,
    "FB feed",
  );

  for (const post of posts) {
    const updatedMs = Date.parse((post.updated_time as string) ?? "");
    if (!Number.isNaN(updatedMs) && updatedMs < opts.cutoffMs) continue;
    res.posts_scanned++;

    // filter=stream inclui respostas aninhadas; reverse pega os mais novos primeiro.
    const comments = await getMetaCollection(
      token,
      `${post.id}/comments?fields=id,message,from,created_time&filter=stream&order=reverse_chronological&limit=${opts.commentLimit}`,
      opts.pageLimit,
      "FB comments",
    );

    for (const c of comments) {
      const createdMs = Date.parse((c.created_time as string) ?? "");
      if (!Number.isNaN(createdMs) && createdMs < opts.cutoffMs) continue;
      const from = (c.from ?? {}) as Json;
      // comentário da própria página (resposta do Cícero) -> não ingere.
      if (from.id === pageId) { res.skipped_own++; continue; }
      res.comments_found++;
      // from pode vir vazio (privacidade/sem pages_read_user_content) -> agrupa como anônimo do post.
      const uid = (from.id as string) ?? `anon-${String(post.id).slice(-8)}`;
      const name = (from.name as string) ?? "Comentário FB";
      const ingest = await ingestInbound(db, channel, {
        from: commentContactExternalId("fb", uid, c.id as string),
        name: `💬 ${name}`,
        metaMessageId: c.id as string,
        msgType: "text",
        content: `💬 ${name} comentou${postRef(post.message as string, post.permalink_url as string)}:\n\n${(c.message as string) || "[sem texto]"}`,
        sentAt: c.created_time as string,
        acct,
      });
      if (ingest.inserted) res.inserted++;
      else if (ingest.reason === "duplicate") res.duplicates++;
      if (ingest.inserted) {
        await maybeAutoReplySocialComment(db, channel, {
          from: commentContactExternalId("fb", uid, c.id as string),
          commentId: c.id as string,
          text: (c.message as string) ?? "",
        });
      }
    }
  }
  return res;
}

async function syncIgComments(
  db: Db,
  channel: Json,
  opts: Opts,
  acct: Awaited<ReturnType<typeof accountForChannel>>,
): Promise<Res> {
  const igId = channel.ig_id as string;
  const token = await channelToken(db, channel.id as string);
  const res: Res = { posts_scanned: 0, comments_found: 0, inserted: 0, duplicates: 0, skipped_own: 0 };

  // username da própria conta pra pular respostas nossas.
  const me = await getMeta(token, `${igId}?fields=username`);
  const ownUsername = ((me.data as Json)?.username as string | undefined)?.toLowerCase() ?? "";

  const posts = await getMetaCollection(
    token,
    `${igId}/media?fields=id,caption,timestamp,permalink&limit=${opts.postLimit}`,
    opts.pageLimit,
    "IG media",
  );

  for (const post of posts) {
    res.posts_scanned++;
    const comments = await getMetaCollection(
      token,
      `${post.id}/comments?fields=id,text,username,from{id,username},timestamp&limit=${opts.commentLimit}`,
      opts.pageLimit,
      "IG comments",
    );

    for (const c of comments) {
      const createdMs = Date.parse((c.timestamp as string) ?? "");
      if (!Number.isNaN(createdMs) && createdMs < opts.cutoffMs) continue;
      const author = (c.from ?? {}) as Json;
      const username = ((c.username as string) ?? (author.username as string) ?? "").trim();
      const authorId = ((author.id as string) ?? "").trim();
      if (username && username.toLowerCase() === ownUsername) { res.skipped_own++; continue; }
      res.comments_found++;
      const ingest = await ingestInbound(db, channel, {
        from: commentContactExternalId("ig", username || authorId, c.id as string),
        name: `💬 @${username || "anônimo"}`,
        metaMessageId: c.id as string,
        msgType: "text",
        content: `💬 @${username || "anônimo"} comentou${postRef(post.caption as string, post.permalink as string)}:\n\n${(c.text as string) || "[sem texto]"}`,
        sentAt: c.timestamp as string,
        acct,
      });
      if (ingest.inserted) res.inserted++;
      else if (ingest.reason === "duplicate") res.duplicates++;
      if (ingest.inserted) {
        await maybeAutoReplySocialComment(db, channel, {
          from: commentContactExternalId("ig", username || authorId, c.id as string),
          commentId: c.id as string,
          text: (c.text as string) ?? "",
        });
      }
    }
  }
  return res;
}

async function getMetaCollection(
  token: string,
  initialPath: string,
  maxPages: number,
  label: string,
): Promise<Json[]> {
  const rows: Json[] = [];
  let path = initialPath;
  for (let page = 0; page < maxPages; page++) {
    const response = await getMeta(token, path);
    if (!response.ok) {
      throw new Error(`${label} ${response.status}: ${JSON.stringify(response.data).slice(0, 200)}`);
    }
    const body = response.data as Json;
    rows.push(...(((body.data ?? []) as Json[])));
    const paging = (body.paging ?? {}) as Json;
    const cursors = (paging.cursors ?? {}) as Json;
    const after = cursors.after as string | undefined;
    if (!paging.next || !after) break;
    path = withMetaCursor(initialPath, after);
  }
  return rows;
}

function isAuthorized(req: Request, url: URL): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = bearer || url.searchParams.get("token") || "";
  if (timingSafeEqual(token, optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET"))) return true;
  const rz = optionalEnv("RYZEAPI_WEBHOOK_TOKEN");
  return rz ? timingSafeEqual(token, rz) : false;
}

function intParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(url.searchParams.get(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
