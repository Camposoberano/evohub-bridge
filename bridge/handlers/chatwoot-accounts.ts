// chatwoot-accounts — CRUD das "telas" Chatwoot (contas) usadas no dashboard.
// Persiste em soberano-config/chatwoot-accounts.json. Auth: JWT do dashboard.
// Mesma instância, mesmo token -> conta = só accountId + label (url default = CHATWOOT_URL).
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Conta = { id: string; label: string; accountId: string; url: string; ativa: boolean };

const BUCKET = "soberano-config";
const FILE = "chatwoot-accounts.json";

async function read(): Promise<Conta[]> {
  try {
    const { data } = await (admin() as any).storage.from(BUCKET).download(FILE);
    if (data) { const j = JSON.parse(await data.text()); if (Array.isArray(j?.accounts)) return j.accounts; }
  } catch { /* vazio */ }
  // seed: conta principal do env
  const acc = optionalEnv("CHATWOOT_ACCOUNT_ID") ?? "1";
  return [{ id: acc, label: "Campo Soberano", accountId: acc, url: env("CHATWOOT_URL"), ativa: true }];
}

async function write(accounts: Conta[]): Promise<void> {
  const body = JSON.stringify({ accounts }, null, 2);
  await (admin() as any).storage.from(BUCKET).upload(FILE, new Blob([body], { type: "application/json" }), {
    upsert: true, contentType: "application/json",
  });
}

export async function handle(req: Request): Promise<Response> {
  const uc = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false },
  });
  if (!(await uc.auth.getUser()).data?.user) return json({ error: "unauthorized" }, 401);

  if (req.method === "GET") return json({ accounts: await read() });

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;
  const accounts = await read();

  if (action === "save") {
    const accountId = String(body.accountId ?? "").trim();
    const label = String(body.label ?? "").trim();
    if (!accountId || !label) return json({ error: "accountId e label obrigatórios" }, 400);
    const url = String(body.url ?? "").trim() || env("CHATWOOT_URL");
    const i = accounts.findIndex((a) => a.id === accountId);
    const conta: Conta = { id: accountId, label, accountId, url, ativa: true };
    if (i >= 0) accounts[i] = { ...accounts[i], ...conta };
    else accounts.push(conta);
    await write(accounts);
    return json({ ok: true, accounts });
  }

  if (action === "remove") {
    const id = String(body.id ?? "").trim();
    const principal = optionalEnv("CHATWOOT_ACCOUNT_ID");
    if (id === principal) return json({ error: "não dá pra remover a conta principal" }, 400);
    await write(accounts.filter((a) => a.id !== id));
    return json({ ok: true, accounts: accounts.filter((a) => a.id !== id) });
  }

  return json({ error: "ação desconhecida: " + action }, 400);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
