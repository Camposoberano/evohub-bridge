// destino-seguro — impede que uma URL vinda de fora faça o bridge buscar recurso na rede
// interna (SSRF).
//
// `relayProviderMedia` faz fetch em `att.data_url`, campo que vem no corpo do webhook
// `message_created` do Chatwoot (chatwoot-webhook.ts). Quem conseguisse forjar esse webhook
// apontaria o data_url para `http://localhost:8000/...`, para um serviço interno da rede
// Coolify ou para o IP de metadados da nuvem — e o bridge faria a requisição de dentro do
// container, com a rede e os privilégios dele.
//
// Escolha deliberada: BLOQUEAR só o que é indiscutivelmente errado (endereço interno) e
// apenas REGISTRAR host público inesperado. Uma allowlist estrita quebraria a mídia no dia
// em que o Chatwoot trocar o ActiveStorage local por S3/R2 — e mídia que não chega é
// prejuízo imediato, enquanto host público desconhecido é só um aviso para investigar.

// Só as faixas /8, onde o primeiro octeto decide sozinho. As demais (169.254, 172.16/12,
// 192.168, 100.64/10) precisam do segundo octeto e são tratadas uma a uma abaixo — uma
// primeira versão desta lista as colocava aqui e deixava 169.254.169.254, o IP de metadados
// de nuvem, PASSAR. O teste pegou.
const PRIMEIRO_OCTETO_INTERNO = new Set([
  0, // 0.0.0.0/8   — "este host"
  10, // 10.0.0.0/8  — privada
  127, // 127.0.0.0/8 — loopback
]);

export function ehIpInterno(ip: string): boolean {
  const limpo = ip.trim().replace(/^\[|\]$/g, "");

  // IPv6
  if (limpo.includes(":")) {
    const baixo = limpo.toLowerCase();
    if (baixo === "::1" || baixo === "::") return true;
    // IPv4 mapeado em IPv6 (::ffff:127.0.0.1)
    const mapeado = baixo.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeado) return ehIpInterno(mapeado[1]);
    // ULA (fc00::/7) e link-local (fe80::/10)
    if (/^f[cd]/.test(baixo)) return true;
    if (/^fe[89ab]/.test(baixo)) return true;
    return false;
  }

  const partes = limpo.split(".");
  if (partes.length !== 4) return false;
  const n = partes.map((p) => Number(p));
  if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;

  if (n[0] === 172) return n[1] >= 16 && n[1] <= 31; // 172.16.0.0/12
  if (n[0] === 192) return n[1] === 168; // 192.168.0.0/16
  if (n[0] === 100) return n[1] >= 64 && n[1] <= 127; // 100.64.0.0/10 (CGNAT)
  if (n[0] === 169) return n[1] === 254; // 169.254.0.0/16 — inclui metadados de nuvem
  return PRIMEIRO_OCTETO_INTERNO.has(n[0]);
}

export function ehHostInterno(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // nomes de serviço em rede Docker/Kubernetes e domínios reservados
  if (!h.includes(".")) return true; // "chatwoot", "redis", "postgres"
  if (/\.(internal|local|localdomain|intranet|cluster\.local)$/.test(h)) {
    return true;
  }
  return ehIpInterno(h);
}

export type DestinoAvaliado =
  | { ok: true; hostConhecido: boolean; host: string }
  | { ok: false; motivo: string };

/**
 * Avalia a URL SEM resolver DNS — parte pura, fácil de testar. A resolução fica em
 * `validarDestinoDeMidia`, que é quem faz E/S.
 */
export function avaliarDestino(
  bruta: string,
  hostsEsperados: string[],
): DestinoAvaliado {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return { ok: false, motivo: "URL inválida" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, motivo: `esquema não permitido: ${url.protocol}` };
  }
  const host = url.hostname.toLowerCase();
  if (ehHostInterno(host)) {
    return { ok: false, motivo: `destino interno bloqueado: ${host}` };
  }
  const esperados = hostsEsperados.map((h) => h.toLowerCase()).filter(Boolean);
  return { ok: true, host, hostConhecido: esperados.includes(host) };
}
