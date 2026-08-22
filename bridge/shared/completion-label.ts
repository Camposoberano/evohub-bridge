import { getConversationLabels, setConversationLabels } from "./chatwoot.ts";
import { optionalEnv } from "./env.ts";
import { claimDelivery, DbClient } from "./supabase.ts";
import { instGet, instPost, listInstances } from "./uazapi.ts";

type Json = Record<string, unknown>;
type Target = "whatsapp" | "chatwoot";

type Rule = { label: string; targets: Target[] };

function rules(): Record<string, Rule> {
  const raw = optionalEnv("FUNNEL_COMPLETION_LABELS_JSON");
  const parsed = raw ? JSON.parse(raw) as Record<string, Json> : {};
  if (!Object.keys(parsed).length) {
    return { "mega-sorgo": { label: "SUL", targets: ["whatsapp", "chatwoot"] } };
  }
  const out: Record<string, Rule> = {};
  for (const [funnel, value] of Object.entries(parsed)) {
    const label = String(value.label ?? "").trim();
    const targets = (Array.isArray(value.targets) ? value.targets : [])
      .map((x) => String(x).toLowerCase())
      .flatMap((x): Target[] => x === "both" ? ["whatsapp", "chatwoot"] :
        x === "whatsapp" || x === "chatwoot" ? [x] : []);
    if (label && targets.length) out[funnel] = { label, targets: [...new Set(targets)] };
  }
  return out;
}

export async function applyCompletionLabel(
  db: DbClient,
  sequence: Json,
): Promise<{ applied: string[]; errors: string[] }> {
  const rule = rules()[String(sequence.funnel ?? "")];
  if (!rule) return { applied: [], errors: [] };
  const errors: string[] = [];
  const applied: string[] = [];
  const { data: conversation } = await db.from("conversations")
    .select("id,channel_id,chatwoot_conversation_id,labels,contacts(external_contact_id),channels(name,type)")
    .eq("id", String(sequence.conversation_id)).maybeSingle();
  if (!conversation) return { applied: [], errors: ["conversation not found"] };

  for (const target of rule.targets) {
    if (target === "whatsapp" && String(conversation.channels?.type ?? "") !== "whatsapp") {
      continue;
    }
    const claim = `completion-label-${sequence.id}-${rule.label}-${target}`;
    if (!await claimDelivery(db, claim, "completion-label")) continue;
    try {
      if (target === "chatwoot") {
        const cwId = Number(conversation.chatwoot_conversation_id ?? 0);
        if (!cwId) throw new Error("conversation sem chatwoot id");
        const current = await getConversationLabels(cwId);
        if (!current.includes(rule.label)) await setConversationLabels(cwId, [...current, rule.label]);
      } else {
        const instances = await listInstances();
        const inst = instances.find((x) => x.name === conversation.channels?.name);
        if (!inst) throw new Error("instância WhatsApp não encontrada");
        const labelRes = await instGet("/labels", inst.token);
        if (!labelRes.ok) throw new Error(`GET /labels ${labelRes.status}`);
        const body = labelRes.data as Json | unknown[];
        const list = (Array.isArray(body) ? body : (body?.labels ?? [])) as Json[];
        const label = list.find((x) => String(x.name ?? x.title ?? "").trim() === rule.label);
        if (!label) throw new Error(`etiqueta WhatsApp não encontrada: ${rule.label}`);
        const number = String(conversation.contacts?.external_contact_id ?? "").replace(/\D/g, "");
        if (!number) throw new Error("contato sem número");
        const result = await instPost("/chat/labels", inst.token, {
          number,
          labelIds: [String(label.id ?? label.labelId)],
          action: "add",
        });
        if (!result.ok) throw new Error(`POST /chat/labels ${result.status}`);
      }
      applied.push(target);
    } catch (e) {
      errors.push(`${target}: ${e instanceof Error ? e.message : String(e)}`);
      await db.from("deliveries").delete().eq("delivery_id", claim);
    }
  }
  if (applied.length) {
    await db.from("events").insert({
      source: "funil",
      event_type: "completion_label_applied",
      channel_id: conversation.channel_id,
      payload: { sequence_id: sequence.id, funnel: sequence.funnel, label: rule.label, targets: applied },
    });
  }
  return { applied, errors };
}
