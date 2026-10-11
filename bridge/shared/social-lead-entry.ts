import { isDefaultAdMessage, pareceAberturaComercial } from "./ad-lead.ts";

export type SocialLeadEntry = "ad_referral" | "commercial_fallback" | null;

export type SocialLeadEvidence = {
  hasReferral: boolean;
  persistedAdOrigin: boolean;
  inboundCount: number;
  openedAt: string | null;
  text: string;
  icebreakers?: string[];
  nowMs?: number;
};

/** Referral é autoritativo; na ausência dele o fallback vale só na abertura. */
export function socialLeadEntry(evidence: SocialLeadEvidence): SocialLeadEntry {
  const openedAt = Date.parse(evidence.openedAt ?? "");
  const ageMs = (evidence.nowMs ?? Date.now()) - openedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 5 * 60_000 ||
    evidence.inboundCount < 1 || evidence.inboundCount > 3) return null;
  if (evidence.hasReferral || evidence.persistedAdOrigin) return "ad_referral";
  return pareceAberturaComercial(evidence.text, evidence.icebreakers ?? []) ||
      isDefaultAdMessage(evidence.text)
    ? "commercial_fallback"
    : null;
}
