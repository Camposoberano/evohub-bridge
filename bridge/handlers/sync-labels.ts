// sync-labels — traz as etiquetas do Chatwoot para `conversations.labels` e deriva `outcome`.
//
// Motivo: o comercial marca venda/não-compra por etiqueta no Chatwoot, mas nada disso chegava
// ao banco do bridge (labels vazio nas 400 conversas, outcome com 399 "open"). Sem isso não há
// taxa de conversão — não dá para saber se uma mudança no funil melhorou algo.
//
// Não sobrescreve outcome definido à mão pelo dashboard (outcome_source='dashboard' vence).
// Roda em loop no server.ts e também aceita chamada manual para backfill.
// Auth: ?token=<SYNC_SECRET|CHATWOOT_WEBHOOK_SECRET>.
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { timingSafeEqual } from "../shared/hmac.ts";
import { type CwAcct, envAcct } from "../shared/chatwoot.ts";

type Outcome = "won" | "lost";

// Etiquetas comerciais → desfecho. O catálogo do Chatwoot tem variantes duplicadas
// ("pago" aparece mais de uma vez, "pagamento-feito" tem descrição "pago"), então todas
// as grafias em uso são mapeadas para o mesmo desfecho.
const OUTCOME_LABELS: Record<string, Outcome> = {
  "pago": "won",
  "pagamento-feito": "won",
  "venda": "won",
  "nao-compra": "lost",
  "nao-tem-interesse": "lost",
  "sem-interesse": "lost",
};

export async function handle(req: Request): Promise<Response> {
  if (!["GET", "POST"].includes(req.method)) {
    return json({ error: "method not allowed" }, 405);
  }
  const url = new URL(req.url);
  if (!isAuthorized(req, url)) return json({ error: "unauthorized" }, 401);

  // Chatwoot pagina de 25 em 25; 30 páginas cobrem 750 conversas com folga.
  const maxPages = intParam(url, "max_pages", 30, 1, 100);
  const acct = envAcct();
  const db = admin();

  let scanned = 0;
  let labelsUpdated = 0;
  let outcomeSet = 0;
  const errors: string[] = [];

  for (let page = 1; page <= maxPages; page++) {
    let convs: Array<Record<string, unknown>>;
    try {
      convs = await listConversations(acct, page);
    } catch (e) {
      errors.push(
        `page ${page}: ${e instanceof Error ? e.message : String(e)}`,
      );
      break;
    }
    if (convs.length === 0) break;

    for (const conv of convs) {
      const cwId = Number(conv.id);
      if (!Number.isFinite(cwId)) continue;
      const labels = normalizeLabels(conv.labels);
      scanned++;

      const { data: row, error: selErr } = await db.from("conversations")
        .select("id,labels,outcome,outcome_source")
        .eq("chatwoot_conversation_id", cwId)
        .maybeSingle();
      if (selErr) {
        errors.push(`conv ${cwId}: ${selErr.message}`);
        continue;
      }
      if (!row) continue; // conversa do Chatwoot que o bridge não conhece

      const patch: Record<string, unknown> = {};

      // 1) espelha as etiquetas (sempre, mesmo sem etiqueta comercial — serve para análise)
      if (!sameLabels(row.labels, labels)) {
        patch.labels = labels;
        labelsUpdated++;
      }

      // 2) deriva o desfecho. "won" ganha de "lost" se as duas estiverem presentes:
      // uma venda registrada é fato, "não compra" pode ter sobrado de antes.
      const derived = deriveOutcome(labels);
      const manual = row.outcome_source === "dashboard";
      if (derived && !manual && row.outcome !== derived) {
        patch.outcome = derived;
        patch.outcome_source = "chatwoot-label";
        patch.outcome_set_at = new Date().toISOString();
        outcomeSet++;
      }

      if (Object.keys(patch).length === 0) continue;
      patch.updated_at = new Date().toISOString();

      const { error: updErr } = await db.from("conversations")
        .update(patch).eq("id", row.id);
      if (updErr) errors.push(`conv ${cwId}: ${updErr.message}`);
    }
  }

  return json({
    ok: true,
    scanned,
    labels_updated: labelsUpdated,
    outcome_set: outcomeSet,
    errors: errors.slice(0, 10),
  });
}

// Lista conversas do Chatwoot com suas etiquetas. `status=all` inclui resolvidas —
// justamente as que têm desfecho.
async function listConversations(
  acct: CwAcct,
  page: number,
): Promise<Array<Record<string, unknown>>> {
  const base = acct.url.replace(/\/+$/, "");
  const res = await fetch(
    `${base}/api/v1/accounts/${acct.accountId}/conversations?status=all&page=${page}`,
    { headers: { "api_access_token": acct.token } },
  );
  if (!res.ok) {
    throw new Error(
      `Chatwoot conversations ${res.status}: ${await res.text()}`,
    );
  }
  const json = await res.json();
  // O endpoint responde {data:{payload:[...]}}; o filter API responde {payload:[...]}.
  const payload = json?.data?.payload ?? json?.payload ?? [];
  return Array.isArray(payload) ? payload : [];
}

function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(raw.map((l) => String(l).trim().toLowerCase()).filter(Boolean)),
  ].sort();
}

function sameLabels(current: unknown, next: string[]): boolean {
  const a = Array.isArray(current) ? normalizeLabels(current) : [];
  return a.length === next.length && a.every((v, i) => v === next[i]);
}

function deriveOutcome(labels: string[]): Outcome | null {
  let lost = false;
  for (const l of labels) {
    const o = OUTCOME_LABELS[l];
    if (o === "won") return "won";
    if (o === "lost") lost = true;
  }
  return lost ? "lost" : null;
}

function isAuthorized(req: Request, url: URL): boolean {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const token = bearer || url.searchParams.get("token") || "";
  const expected = optionalEnv("SYNC_SECRET") ?? env("CHATWOOT_WEBHOOK_SECRET");
  return timingSafeEqual(token, expected);
}

function intParam(
  url: URL,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Number(url.searchParams.get(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
