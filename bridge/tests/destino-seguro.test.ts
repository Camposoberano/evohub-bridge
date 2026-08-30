import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  avaliarDestino,
  ehHostInterno,
  ehIpInterno,
} from "../shared/destino-seguro.ts";

// relayProviderMedia faz fetch na URL que vem do webhook do Chatwoot. Sem validação, quem
// forjasse o webhook apontaria para a rede interna do container.

const ESPERADOS = ["gerenciador.soberano.pro"];

Deno.test("endereço interno é bloqueado em todas as formas conhecidas", () => {
  for (const alvo of [
    "http://localhost:8000/x",
    "http://127.0.0.1/x",
    "http://127.10.20.30/x",
    "http://10.0.0.5/x",
    "http://192.168.1.10/x",
    "http://172.16.0.1/x",
    "http://172.31.255.254/x",
    "http://169.254.169.254/latest/meta-data/", // metadados de nuvem
    "http://[::1]/x",
    "http://[::ffff:127.0.0.1]/x",
    "http://[fd00::1]/x",
    "http://chatwoot:3000/x", // nome de serviço em rede Docker
    "http://redis.internal/x",
    "http://0.0.0.0/x",
  ]) {
    const r = avaliarDestino(alvo, ESPERADOS);
    assertEquals(r.ok, false, `deveria bloquear: ${alvo}`);
  }
});

Deno.test("172.x fora da faixa privada continua liberado", () => {
  // 172.15 e 172.32 são públicos — bloquear seria falso positivo
  assertEquals(ehIpInterno("172.15.0.1"), false);
  assertEquals(ehIpInterno("172.32.0.1"), false);
  assertEquals(ehIpInterno("172.16.0.1"), true);
  assertEquals(ehIpInterno("192.169.0.1"), false);
});

Deno.test("host legítimo do Chatwoot passa e é reconhecido", () => {
  const r = avaliarDestino(
    "https://gerenciador.soberano.pro/rails/active_storage/blobs/abc/foto.jpg",
    ESPERADOS,
  );
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.hostConhecido, true);
});

// A escolha é deliberada: host público desconhecido PASSA, só fica registrado. Uma
// allowlist estrita quebraria a mídia no dia em que o Chatwoot migrar para S3/R2.
Deno.test("host público desconhecido passa, mas é sinalizado", () => {
  const r = avaliarDestino("https://cdn.terceiro.com/x.jpg", ESPERADOS);
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.hostConhecido, false);
});

Deno.test("esquema fora de http/https é bloqueado", () => {
  assertEquals(avaliarDestino("file:///etc/passwd", ESPERADOS).ok, false);
  assertEquals(avaliarDestino("gopher://x/1", ESPERADOS).ok, false);
  assertEquals(avaliarDestino("nao-e-url", ESPERADOS).ok, false);
});

Deno.test("ehHostInterno cobre nome sem ponto e sufixos reservados", () => {
  assertEquals(ehHostInterno("postgres"), true);
  assertEquals(ehHostInterno("app.cluster.local"), true);
  assertEquals(ehHostInterno("gerenciador.soberano.pro"), false);
});
