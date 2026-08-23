const BRIDGE_URL = process.env.NEXT_PUBLIC_BRIDGE_URL || "https://cofre.camposoberano.com.br";

export async function GET() {
  try {
    const [health, version] = await Promise.all([
      fetch(`${BRIDGE_URL}/health`, { cache: "no-store" }),
      fetch(`${BRIDGE_URL}/version`, { cache: "no-store" }),
    ]);
    const body = await version.json().catch(() => ({}));
    const payload = {
      ok: health.ok,
      build: body.build || "build não informado",
      healthStatus: health.status,
    };
    return Response.json(payload, { status: health.ok ? 200 : 503 });
  } catch {
    return Response.json({ ok: false, build: "indisponível" }, { status: 503 });
  }
}
