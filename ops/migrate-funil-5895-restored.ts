import { admin } from "../bridge/shared/supabase.ts";
import { enrollIfNew } from "../bridge/handlers/funil-enroll.ts";
import {
  AD_5895_FUNNEL,
  LEGACY_MAIN_FUNNEL,
  RESTORED_5895_FUNNEL,
} from "../bridge/shared/funnel-identity.ts";
import {
  isContactBlocked,
  isContactExcludedFromAutomation,
} from "../bridge/shared/lead-block.ts";

const CHANNEL_ID = "cf316d59-f6da-4683-adcc-29095a805dde";
const SINCE = "2026-10-06T03:00:00.000Z";
const APPLY = Deno.args.includes("--apply");
const ONLY = new Set(
  Deno.args.filter((arg) => arg.startsWith("--only="))
    .flatMap((arg) => arg.slice("--only=".length).split(","))
    .map((id) => id.trim()).filter(Boolean),
);
// Esses três casos foram citados nominalmente pelo responsável no pedido de reenvio.
const FORCE_CHATWOOT_IDS = new Set(["3501", "3503", "3509"]);
const OLD_FUNNELS = [LEGACY_MAIN_FUNNEL, AD_5895_FUNNEL];
type Json = Record<string, unknown>;

const db = admin();
const { data: channel, error: channelError } = await db.from("channels")
  .select("id,name,external_id,phone_number")
  .eq("id", CHANNEL_ID).maybeSingle();
if (channelError) throw channelError;
if (!channel) throw new Error(`canal ${CHANNEL_ID} não encontrado`);

const { data: conversations, error: conversationError } = await db.from(
  "conversations",
).select(
  "id,contact_id,chatwoot_conversation_id,opened_at,origem,referral,status,outcome,bot_muted_at,assignee",
).eq("channel_id", CHANNEL_ID).gte("opened_at", SINCE)
  .order("opened_at", { ascending: true }).limit(500);
if (conversationError) throw conversationError;

const ids = ((conversations ?? []) as Json[]).map((row) => String(row.id));
if (!ids.length) {
  console.log(
    JSON.stringify({ mode: APPLY ? "apply" : "dry-run", manifest: [] }),
  );
  Deno.exit(0);
}
const [
  { data: sequences, error: sequenceError },
  { data: contacts, error: contactError },
  { data: humanEvents, error: humanEventError },
] = await Promise.all([
  db.from("sales_sequences").select("id,conversation_id,funnel,status")
    .in("conversation_id", ids).in(
      "funnel",
      OLD_FUNNELS.concat(RESTORED_5895_FUNNEL),
    ).limit(2000),
  db.from("contacts").select("id,external_contact_id,attributes").in(
    "id",
    ((conversations ?? []) as Json[]).map((row) => row.contact_id),
  ).limit(500),
  db.from("events").select("payload")
    .eq("source", "atendimento").eq("event_type", "pediu_humano")
    .gte("received_at", SINCE).limit(5000),
]);
if (sequenceError) throw sequenceError;
if (contactError) throw contactError;
if (humanEventError) throw humanEventError;
if ((humanEvents ?? []).length === 5000) {
  throw new Error(
    "consulta de pedidos humanos atingiu limite; revisar paginação",
  );
}
const humanKindsByConversation = new Map<string, Set<string>>();
for (const event of (humanEvents ?? []) as Json[]) {
  const payload = (event.payload as Json | undefined) ?? {};
  const conversationId = String(payload.conversation_id ?? "");
  if (!conversationId) continue;
  const kinds = humanKindsByConversation.get(conversationId) ??
    new Set<string>();
  kinds.add(String(payload.tipo_pedido ?? "atendimento"));
  humanKindsByConversation.set(conversationId, kinds);
}
const quoteOnlyIds = new Set(
  [...humanKindsByConversation].filter(([, kinds]) =>
    [...kinds].every((kind) => kind === "cotacao")
  ).map(([id]) => id),
);
const humanRequestedIds = new Set(
  [...humanKindsByConversation].filter(([, kinds]) =>
    [...kinds].some((kind) => kind !== "cotacao")
  ).map(([id]) => id),
);

const sequenceByConversation = new Map<string, Json[]>();
for (const sequence of (sequences ?? []) as Json[]) {
  const id = String(sequence.conversation_id);
  sequenceByConversation.set(id, [
    ...(sequenceByConversation.get(id) ?? []),
    sequence,
  ]);
}
const contactById = new Map<string, Json>(
  ((contacts ?? []) as Json[]).map((row) => [String(row.id), row]),
);
const candidates = ((conversations ?? []) as Json[]).map((conversation) => {
  const chatwootId = String(conversation.chatwoot_conversation_id ?? "");
  const existing = sequenceByConversation.get(String(conversation.id)) ?? [];
  const old = existing.filter((sequence) =>
    OLD_FUNNELS.includes(String(sequence.funnel))
  );
  const restored = existing.find((sequence) =>
    sequence.funnel === RESTORED_5895_FUNNEL
  );
  const hasReferral = Boolean(conversation.referral) &&
    Object.keys(conversation.referral ?? {}).length > 0;
  const adEvidence = conversation.origem === "anuncio" || hasReferral ||
    old.some((sequence) => sequence.funnel === AD_5895_FUNNEL) ||
    FORCE_CHATWOOT_IDS.has(chatwootId);
  const terminal = conversation.status === "resolved" ||
    String(conversation.outcome ?? "open") !== "open" ||
    Boolean(conversation.bot_muted_at);
  const contact = contactById.get(String(conversation.contact_id));
  const excluded = isContactBlocked(contact) ||
    isContactExcludedFromAutomation(contact);
  const assigned = Boolean(String(conversation.assignee ?? "").trim());
  const humanRequested = humanRequestedIds.has(String(conversation.id));
  const explicitCase = FORCE_CHATWOOT_IDS.has(chatwootId);
  const priceCase = quoteOnlyIds.has(String(conversation.id));
  const eligible = (ONLY.size === 0 || ONLY.has(chatwootId)) &&
    adEvidence && !terminal && !excluded &&
    (!assigned && !humanRequested || explicitCase || priceCase) &&
    !restored &&
    Boolean(contact?.external_contact_id);
  const reason = restored
    ? "já tem versão restaurada"
    : terminal
    ? "conversa encerrada, bloqueada ou com bot desligado"
    : excluded
    ? "contato excluído da automação"
    : (assigned || humanRequested) && !explicitCase && !priceCase
    ? "atendimento humano atribuído ou solicitado"
    : ONLY.size && !ONLY.has(chatwootId)
    ? "fora do filtro --only"
    : !adEvidence
    ? "sem evidência de anúncio"
    : !contact?.external_contact_id
    ? "contato sem identificador"
    : "elegível";
  return {
    conversation,
    contact,
    old,
    restored,
    eligible,
    reason,
    oldRows: 0,
    oldPending: 0,
    oldPaused: 0,
  };
});

for (const candidate of candidates) {
  if (!candidate.old.length) continue;
  const { data: rows, error } = await db.from("scheduled_messages")
    .select("id,status").eq("conversation_id", candidate.conversation.id)
    .in("funnel", OLD_FUNNELS).limit(500);
  if (error) throw error;
  candidate.oldRows = rows?.length ?? 0;
  candidate.oldPending = ((rows ?? []) as Json[]).filter((row) =>
    row.status === "pending"
  ).length;
  candidate.oldPaused =
    ((rows ?? []) as Json[]).filter((row) => row.status === "paused").length;
}

const manifest = candidates.map((candidate) => ({
  chatwoot: candidate.conversation.chatwoot_conversation_id,
  opened_at: candidate.conversation.opened_at,
  assignee: candidate.conversation.assignee,
  human_requested: humanRequestedIds.has(String(candidate.conversation.id)),
  quotation_only: quoteOnlyIds.has(String(candidate.conversation.id)),
  old_funnels: candidate.old.map((sequence) => sequence.funnel),
  old_rows: candidate.oldRows,
  future_rows_to_cancel: candidate.oldPending + candidate.oldPaused,
  eligible: candidate.eligible,
  reason: candidate.reason,
}));
console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      channel: CHANNEL_ID,
      since: SINCE,
      manifest,
    },
    null,
    2,
  ),
);

if (!APPLY) Deno.exit(0);

const results: Json[] = [];
for (const candidate of candidates.filter((item) => item.eligible)) {
  const conversationId = String(candidate.conversation.id);
  const chatwoot = candidate.conversation.chatwoot_conversation_id;
  try {
    // A revisão pode demorar. Conferir de novo imediatamente antes de inscrever.
    const { data: current, error: currentError } = await db.from(
      "conversations",
    )
      .select("id,status,outcome,bot_muted_at,assignee,contact_id")
      .eq("id", conversationId).maybeSingle();
    if (currentError) throw currentError;
    const { data: currentContact, error: contactError } = await db.from(
      "contacts",
    ).select("id,attributes,external_contact_id")
      .eq("id", String(current?.contact_id ?? "")).maybeSingle();
    if (contactError) throw contactError;
    if (
      !current || !currentContact || current.status === "resolved" ||
      String(current.outcome ?? "open") !== "open" ||
      current.bot_muted_at || isContactBlocked(currentContact) ||
      isContactExcludedFromAutomation(currentContact) ||
      (String(current.assignee ?? "").trim() &&
        !FORCE_CHATWOOT_IDS.has(String(chatwoot)) &&
        !quoteOnlyIds.has(conversationId))
    ) {
      results.push({ chatwoot, outcome: "skipped_state_changed" });
      continue;
    }
    const outcome = await enrollIfNew(
      db,
      channel as Json,
      String(currentContact.external_contact_id),
      {
        manual: true,
        originSignal: "persisted_ad_origin",
        conversation: candidate.conversation as Json,
      },
    );
    if (outcome !== "created" && outcome !== "already") {
      results.push({ chatwoot, outcome });
      continue;
    }
    const { data: restoredRows, error: restoredError } = await db.from(
      "scheduled_messages",
    ).select("id,status").eq("conversation_id", conversationId)
      .eq("funnel", RESTORED_5895_FUNNEL).limit(100);
    if (restoredError) throw restoredError;
    if ((restoredRows ?? []).length !== 31) {
      throw new Error(
        `versão restaurada tem ${
          restoredRows?.length ?? 0
        } etapas; esperado 31`,
      );
    }
    const { error: cancelRowsError } = await db.from("scheduled_messages")
      .update({ status: "cancelled" })
      .eq("conversation_id", conversationId).in("funnel", OLD_FUNNELS)
      .in("status", ["pending", "paused"]);
    if (cancelRowsError) throw cancelRowsError;
    const { error: cancelSequenceError } = await db.from("sales_sequences")
      .update({ status: "cancelled" })
      .eq("conversation_id", conversationId).in("funnel", OLD_FUNNELS)
      .in("status", ["running", "paused"]);
    if (cancelSequenceError) throw cancelSequenceError;
    const { error: eventError } = await db.from("events").insert({
      source: "sales-funnel",
      event_type: "restored_funnel_migrated",
      payload: {
        conversation_id: conversationId,
        chatwoot_conversation_id: chatwoot,
        restored_funnel: RESTORED_5895_FUNNEL,
        replaced_funnels: candidate.old.map((row) => row.funnel),
        steps: restoredRows.length,
        enrollment_outcome: outcome,
      },
    });
    if (eventError) throw eventError;
    results.push({ chatwoot, outcome, steps: restoredRows.length });
  } catch (error) {
    results.push({
      chatwoot,
      outcome: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
console.log(JSON.stringify({ migrated: results.length, results }, null, 2));
