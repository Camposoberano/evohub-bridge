import { admin } from "../bridge/shared/supabase.ts";
import { instPost, listInstances } from "../bridge/shared/uazapi.ts";
import { RESTORED_5895_FUNNEL } from "../bridge/shared/funnel-identity.ts";

type Json = Record<string, unknown>;
const digits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const db = admin();
const { data: sequences, error: sequenceError } = await db.from(
  "sales_sequences",
).select("conversation_id").eq("funnel", RESTORED_5895_FUNNEL)
  .limit(1000);
if (sequenceError) throw sequenceError;
const conversationIds = ((sequences ?? []) as Json[]).map((row) =>
  String(row.conversation_id)
);
if (!conversationIds.length) throw new Error("nenhuma sequência restaurada");
const [conversationsResult, rowsResult] = await Promise.all([
  db.from("conversations").select(
    "id,chatwoot_conversation_id,channel_id,contacts(external_contact_id)",
  ).in("id", conversationIds).limit(1000),
  db.from("scheduled_messages").select(
    "id,conversation_id,step,status,send_at,sent_at,payload",
  ).in("conversation_id", conversationIds).eq("funnel", RESTORED_5895_FUNNEL)
    .in("step", [5, 6, 7, 10]).limit(1000),
]);
if (conversationsResult.error) throw conversationsResult.error;
if (rowsResult.error) throw rowsResult.error;
const conversations = (conversationsResult.data ?? []) as Json[];
const rows = (rowsResult.data ?? []) as Json[];
const channelIds = [...new Set(conversations.map((row) => String(row.channel_id)))];
if (channelIds.length !== 1) throw new Error("sequências em vários canais");
const { data: channel, error: channelError } = await db.from("channels")
  .select("phone_number").eq("id", channelIds[0]).single();
if (channelError) throw channelError;
const instance = (await listInstances()).find((item) =>
  digits(item.number) === digits(channel.phone_number)
);
if (!instance?.token) throw new Error("instância 5895 não encontrada");

const byConversation = new Map<string, Json[]>();
for (const row of rows) {
  const id = String(row.conversation_id);
  byConversation.set(id, [...(byConversation.get(id) ?? []), row]);
}
const results: Json[] = [];
for (const conversation of conversations) {
  const chatwoot = conversation.chatwoot_conversation_id;
  const recipient = digits(
    (conversation.contacts as Json | null)?.external_contact_id,
  );
  const scheduled = byConversation.get(String(conversation.id)) ?? [];
  const video = scheduled.find((row) => row.step === 5);
  const next = scheduled.find((row) => row.step === 6);
  const phase2 = scheduled.find((row) => row.step === 7);
  const phase2Video = scheduled.find((row) => row.step === 10);
  if (!video || !/^55\d{10,11}$/.test(recipient)) {
    results.push({ chatwoot, error: "missing video or recipient" });
    continue;
  }
  const mediaUrl = String((video.payload as Json)?.media_url ?? "");
  const provider = await instPost("/message/find", instance.token, {
    chatid: `${recipient}@s.whatsapp.net`,
    limit: 100,
    offset: 0,
  });
  if (!provider.ok) {
    results.push({ chatwoot, error: `provider HTTP ${provider.status}` });
    continue;
  }
  const messages = Array.isArray((provider.data as Json).messages)
    ? (provider.data as Json).messages as Json[]
    : [];
  const scheduledAt = Date.parse(String(video.send_at));
  const matches = messages.filter((message) =>
    message.fromMe === true &&
    String(message.messageType).toLowerCase().includes("video") &&
    (message.sendPayload as Json | undefined)?.file === mediaUrl &&
    Number(message.messageTimestamp) >= scheduledAt - 30_000 &&
    Number(message.messageTimestamp) < scheduledAt + 10 * 60_000
  );
  const phase2Due = phase2 && Date.parse(String(phase2.send_at)) < Date.now();
  const phase2At = phase2Due ? Date.parse(String(phase2.send_at)) : 0;
  const phase2Text = phase2Due
    ? String((phase2.payload as Json)?.text ?? "")
    : "";
  const phase2Matches = phase2Due
    ? messages.filter((message) =>
      message.fromMe === true &&
      (message.sendPayload as Json | undefined)?.text === phase2Text &&
      Number(message.messageTimestamp) >= phase2At - 30_000 &&
      Number(message.messageTimestamp) < phase2At + 10 * 60_000
    )
    : [];
  const phase2VideoDue = phase2Video &&
    Date.parse(String(phase2Video.send_at)) < Date.now();
  const phase2VideoAt = phase2VideoDue
    ? Date.parse(String(phase2Video.send_at))
    : 0;
  const phase2VideoFile = phase2VideoDue
    ? String((phase2Video.payload as Json)?.media_url ?? "")
    : "";
  const phase2VideoMatches = phase2VideoDue
    ? messages.filter((message) =>
      message.fromMe === true &&
      String(message.messageType).toLowerCase().includes("video") &&
      (message.sendPayload as Json | undefined)?.file === phase2VideoFile &&
      Number(message.messageTimestamp) >= phase2VideoAt - 30_000 &&
      Number(message.messageTimestamp) < phase2VideoAt + 10 * 60_000
    )
    : [];
  results.push({
    chatwoot,
    video_status: video.status,
    provider_copies: matches.length,
    provider_delivered: matches.filter((message) =>
      ["Delivered", "Read", "Played"].includes(String(message.status))
    ).length,
    ...(matches.length > 1
      ? {
        provider_times: matches.map((message) =>
          new Date(Number(message.messageTimestamp)).toISOString()
        ).sort(),
      }
      : {}),
    next_status: next?.status ?? null,
    phase2_due: Boolean(phase2Due),
    phase2_status: phase2?.status ?? null,
    phase2_provider_delivered: phase2Due
      ? phase2Matches.filter((message) =>
        ["Delivered", "Read", "Played"].includes(String(message.status))
      ).length
      : null,
    phase2_video_due: Boolean(phase2VideoDue),
    phase2_video_status: phase2Video?.status ?? null,
    phase2_video_provider_delivered: phase2VideoDue
      ? phase2VideoMatches.filter((message) =>
        ["Delivered", "Read", "Played"].includes(String(message.status))
      ).length
      : null,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const totals = {
  conversations: results.length,
  video_status_sent: results.filter((row) => row.video_status === "sent")
    .length,
  provider_confirmed_at_least_once: results.filter((row) =>
    Number(row.provider_delivered) >= 1
  ).length,
  provider_duplicates: results.filter((row) =>
    Number(row.provider_delivered) > 1
  ).length,
  next_step_sent: results.filter((row) => row.next_status === "sent").length,
  phase2_due: results.filter((row) => row.phase2_due).length,
  phase2_sent: results.filter((row) => row.phase2_status === "sent").length,
  phase2_provider_confirmed: results.filter((row) =>
    Number(row.phase2_provider_delivered) >= 1
  ).length,
  phase2_provider_duplicates: results.filter((row) =>
    Number(row.phase2_provider_delivered) > 1
  ).length,
  phase2_video_due: results.filter((row) => row.phase2_video_due).length,
  phase2_video_confirmed: results.filter((row) =>
    Number(row.phase2_video_provider_delivered) >= 1
  ).length,
  phase2_video_duplicates: results.filter((row) =>
    Number(row.phase2_video_provider_delivered) > 1
  ).length,
};
console.log(JSON.stringify({
  totals,
  historical_duplicates: results.filter((row) =>
    Number(row.provider_delivered) > 1
  ).map((row) => ({
    chatwoot: row.chatwoot,
    provider_times: row.provider_times,
  })),
  current_anomalies: results.filter((row) =>
    row.error || Number(row.provider_delivered) < 1 ||
    row.video_status !== "sent" ||
    (row.phase2_due && row.phase2_status !== "paused" &&
      (row.phase2_status !== "sent" ||
        Number(row.phase2_provider_delivered) !== 1)) ||
    (row.phase2_video_due && row.phase2_video_status !== "paused" &&
      (row.phase2_video_status !== "sent" ||
        Number(row.phase2_video_provider_delivered) !== 1))
  ),
}, null, 2));
