// chatwoot-accounts — CRUD das "telas" Chatwoot (contas) usadas no dashboard.
// Persiste em soberano-config/chatwoot-accounts.json. Auth: JWT do dashboard.
// Mesma instância, mesmo token -> conta = só accountId + label (url default = CHATWOOT_URL).
import { admin } from "../shared/supabase.ts";
import { env, optionalEnv } from "../shared/env.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;
type Conta = { id: string; label: string; accountId: string; url: string; token?: string; ativa: boolean };

// remove o token bruto antes de devolver pro painel (segredo só no servidor).
function mask(c: Conta): Json {
  return { id: c.id, label: c.label, accountId: c.accountId, url: c.url, ativa: c.ativa, hasToken: !!c.token, tokenMask: c.token ? "••••" + c.token.slice(-4) : null };
}

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

  if (req.method === "GET") return json({ accounts: (await read()).map(mask) });

  const body = await req.json().catch(() => ({})) as Json;
  const action = body.action as string;
  const accounts = await read();

  if (action === "save") {
    const accountId = String(body.accountId ?? "").trim();
    const label = String(body.label ?? "").trim();
    if (!accountId || !label) return json({ error: "accountId e label obrigatórios" }, 400);
    const url = String(body.url ?? "").trim() || env("CHATWOOT_URL");
    const token = String(body.token ?? "").trim(); // só pra instância externa; vazio = usa env
    const externo = url.replace(/\/+$/, "") !== env("CHATWOOT_URL").replace(/\/+$/, "");
    // id único: mesma instância -> accountId; externa -> url+accountId (evita colisão de account_id entre instâncias)
    const id = externo ? `${url.replace(/\/+$/, "")}#${accountId}` : accountId;
    const i = accounts.findIndex((a) => a.id === id);
    const conta: Conta = {
      id, label, accountId, url, ativa: true,
      token: token || (i >= 0 ? accounts[i].token : undefined), // mantém token antigo se não reenviou
    };
    if (externo && !conta.token) return json({ error: "Chatwoot externo (outra URL) exige token" }, 400);
    if (i >= 0) accounts[i] = conta;
    else accounts.push(conta);
    await write(accounts);
    return json({ ok: true, accounts: accounts.map(mask) });
  }

  if (action === "remove") {
    const id = String(body.id ?? "").trim();
    const principal = optionalEnv("CHATWOOT_ACCOUNT_ID");
    if (id === principal) return json({ error: "não dá pra remover a conta principal" }, 400);
    const rest = accounts.filter((a) => a.id !== id);
    await write(rest);
    return json({ ok: true, accounts: rest.map(mask) });
  }

  return json({ error: "ação desconhecida: " + action }, 400);
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
