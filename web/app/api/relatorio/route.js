// Proxy server-side pro /relatorio do bridge.
//
// bridge/handlers/relatorio.ts passou a exigir auth (defeito 9 da auditoria de mensagens
// 08/2026 -- antes o endpoint era público e servia transcrição de conversa/nome de
// cliente/telefone pra qualquer request). O bridge aceita um JWT de usuário Supabase
// (bridge/shared/report-auth.ts), mas um <iframe src="..."> não consegue mandar um header
// Authorization -- por isso este proxy: roda no servidor do painel, recebe o access_token
// da sessão já aberta no browser (Authorization: Bearer <token>, mandado pelo fetch em
// page.jsx) e repassa pro bridge. O token nunca fica embutido em HTML/JS público.
const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "https://cofre.camposoberano.com.br";

export async function GET(req) {
  const auth = req.headers.get("authorization");
  if (!auth) {
    return new Response("unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const data = searchParams.get("data");
  const upstream = new URL(`${BRIDGE_URL}/relatorio`);
  if (data) upstream.searchParams.set("data", data);

  const res = await fetch(upstream.toString(), {
    headers: { Authorization: auth },
  });
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
