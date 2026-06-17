// Enriquecimento de clientes (uazapi). Roda como loop no bridge (sempre-on, resumível).
// Fase 1 (check, lote): on_whatsapp/jid/lid/verified_name. Fase 2 (details, 1 a 1): foto/nomes/grupos.
import { instPost } from "./uazapi.ts";
import type { DbClient } from "./supabase.ts";

type Json = Record<string, unknown>;

export async function enrichStep(db: DbClient, token: string): Promise<string> {
  // FASE 1: check em lote (on_whatsapp ainda nulo)
  const { data: toCheck } = await db.from("clientes").select("phone").is("on_whatsapp", null).limit(40);
  if (toCheck?.length) {
    const numbers = toCheck.map((c: Json) => c.phone as string);
    const r = await instPost("/chat/check", token, { numbers });
    const arr = (Array.isArray(r.data) ? r.data : []) as Json[];
    const byQ = new Map<string, Json>();
    for (const it of arr) byQ.set(String(it.query).replace(/\D/g, ""), it);
    for (const c of toCheck) {
      const it = byQ.get(c.phone as string);
      await db.from("clientes").update({
        on_whatsapp: it ? !!it.isInWhatsapp : false,
        jid: (it?.jid as string) ?? null,
        lid: (it?.lid as string) ?? null,
        verified_name: (it?.verifiedName as string) ?? null,
        enrich_status: it?.isInWhatsapp ? "checked" : "no_wa",
        updated_at: new Date().toISOString(),
      }).eq("phone", c.phone);
    }
    return `check ${toCheck.length}`;
  }

  // FASE 2: details 1 a 1 (checked + tem WhatsApp + ainda sem nome)
  const { data: toDetail } = await db.from("clientes").select("phone")
    .eq("enrich_status", "checked").eq("on_whatsapp", true).limit(1);
  if (toDetail?.length) {
    const phone = toDetail[0].phone as string;
    const r = await instPost("/chat/details", token, { number: phone });
    const d = (r.data ?? {}) as Json;
    const groups = d.wa_common_groups;
    await db.from("clientes").update({
      wa_name: (d.wa_name as string) ?? (d.name as string) ?? null,
      wa_contact_name: (d.wa_contactName as string) ?? null,
      verified_name: (d.verifiedName as string) ?? undefined,
      image_url: (d.image as string) ?? null,
      image_preview: (d.imagePreview as string) ?? null,
      common_groups: Array.isArray(groups) ? groups.length : (typeof groups === "number" ? groups : null),
      lead_name: (d.lead_name as string) ?? (d.lead_fullName as string) ?? null,
      lead_tags: Array.isArray(d.lead_tags) ? (d.lead_tags as string[]).join(",") : ((d.lead_tags as string) ?? null),
      labels: (d.wa_label as string) ?? null,
      raw: d,
      enrich_status: "done",
      updated_at: new Date().toISOString(),
    }).eq("phone", phone);
    return `details ${phone}`;
  }

  return "idle";
}
