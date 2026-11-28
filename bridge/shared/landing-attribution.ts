// A landing session is linked to a Chatwoot conversation only when the customer
// sends the prefilled message containing this explicit, non-personal reference.
export type Json = Record<string, unknown>;

const META_ID = "([0-9]{1,24})";
const SESSION_ID = "([a-f0-9]{16})";

function read(text: string, expression: RegExp): string | null {
  const value = expression.exec(text)?.[1]?.trim();
  return value || null;
}

export function parseLandingWhatsAppAttribution(content: string): Json | null {
  if (typeof content !== "string" || !content) return null;

  const marker = /Origem:\s*Landing WhatsApp\s*\|\s*rota:\s*(6836|5895)(?=\s|$)/i.exec(content);
  if (!marker) return null;

  const reference = read(content, new RegExp(`(?:^|\\s)refer[eê]ncia:\\s*${SESSION_ID}(?=\\s|$)`, "i"));
  const campaignId = read(content, new RegExp(`(?:^|\\s)campanha:\\s*${META_ID}(?=\\s|$)`, "i"));
  const adId = read(content, new RegExp(`(?:^|\\s)anúncio:\\s*${META_ID}(?=\\s|$)`, "i"));
  const adSetId = read(content, new RegExp(`(?:^|\\s)conjunto:\\s*${META_ID}(?=\\s|$)`, "i"));
  const utmSource = read(content, /(?:^|\s)origem:\s*(fb|ig|paid_social)(?=\s|$)/i);

  return {
    source_type: "landing",
    landing_source: "landing-whatsapp",
    landing_route: marker[1],
    ...(reference ? { landing_session_id: reference.toLowerCase() } : {}),
    ...(utmSource ? { utm_source: utmSource.toLowerCase() } : {}),
    ...(campaignId ? { campaign_id: campaignId } : {}),
    ...(adId ? { ad_id: adId } : {}),
    ...(adSetId ? { adset_id: adSetId } : {}),
    source_url: "https://soberano.pro/captar/",
  };
}
