// Orquestrador do catch-up. Os testes de `catchup-uazapi.test.ts` cobrem só função pura
// (janela, timestamp, filtro de candidata, paginação) — e o risco todo mora neste laço:
// soltar claim, deduplicar por `meta_message_id`, isolar erro de uma instância e avisar
// quando a varredura não conseguiu trabalhar. Sem isso, a rede de segurança pode estar
// furada e só se descobre no próximo incidente, contando mensagem de cliente perdida.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type CatchupDeps,
  recuperarEntradaUazapi,
} from "../shared/catchup-uazapi.ts";

type LinhaEvento = { event_type: string; payload: Record<string, unknown> };

type EstadoFalso = {
  canais: Record<string, Record<string, unknown> | undefined>;
  jaGravadas: string[];
  eventos: LinhaEvento[];
  claimsSoltos: string[];
  erroNoCanal?: boolean;
  erroNasGravadas?: boolean;
  erroNoEvento?: boolean;
};

function dbFalso(estado: EstadoFalso) {
  const relacao = (tabela: string) => ({
    select(_cols: string) {
      const filtros: Record<string, string> = {};
      const alvo = {
        eq(coluna: string, valor: string) {
          filtros[coluna] = valor;
          return alvo;
        },
        in(_coluna: string, lote: string[]) {
          if (estado.erroNasGravadas) {
            return Promise.resolve({ data: null, error: { message: "502" } });
          }
          return Promise.resolve({
            data: lote.filter((id) => estado.jaGravadas.includes(id))
              .map((id) => ({ meta_message_id: id })),
            error: null,
          });
        },
        maybeSingle() {
          if (estado.erroNoCanal) {
            return Promise.resolve({ data: null, error: { message: "dois canais" } });
          }
          const chave = filtros.external_id ?? filtros.name ?? "";
          return Promise.resolve({ data: estado.canais[chave] ?? null, error: null });
        },
      };
      return alvo;
    },
    insert(linha: LinhaEvento) {
      if (tabela === "events" && estado.erroNoEvento) {
        return Promise.resolve({ error: { message: "events fora do ar" } });
      }
      estado.eventos.push(linha);
      return Promise.resolve({ error: null });
    },
    delete() {
      return {
        eq(_coluna: string, id: string) {
          return {
            lt(_data: string, _corte: string) {
              estado.claimsSoltos.push(id);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  });
  return { from: (tabela: string) => relacao(tabela) } as never;
}

const CANAL_ATIVO = { id: "ch-1", name: "5895", status: "active" };
const AGORA = Date.parse("2026-09-13T12:00:00Z");
const HA_UMA_HORA = AGORA - 60 * 60_000;

function mensagem(id: string, quandoMs: number) {
  return {
    id,
    messageid: id.split(":").pop(),
    fromMe: false,
    isGroup: false,
    chatid: "5511999998888@s.whatsapp.net",
    messageType: "text",
    text: "oi, ainda tem sorgo?",
    messageTimestamp: Math.floor(quandoMs / 1000),
  };
}

function deps(
  instancias: Record<string, unknown>[],
  mensagens: Record<string, unknown>[],
  extras: Partial<CatchupDeps> = {},
): CatchupDeps {
  return {
    listarInstancias: () => Promise.resolve({ ok: true, status: 200, data: instancias }),
    buscarPagina: () => Promise.resolve({ ok: true, data: mensagens }),
    contaDoCanal: () => Promise.resolve({} as never),
    ingerir: () => Promise.resolve({ inserted: true }),
    ...extras,
  };
}

// `recuperarEntradaUazapi` desiste na hora quando a uazapi não está configurada.
function comUazapiConfigurada<T>(fn: () => Promise<T>): Promise<T> {
  const antes = {
    url: Deno.env.get("UAZAPI_URL"),
    token: Deno.env.get("UAZAPI_ADMIN_TOKEN"),
  };
  Deno.env.set("UAZAPI_URL", "https://uazapi.test");
  Deno.env.set("UAZAPI_ADMIN_TOKEN", "token-de-teste");
  return fn().finally(() => {
    if (antes.url === undefined) Deno.env.delete("UAZAPI_URL");
    else Deno.env.set("UAZAPI_URL", antes.url);
    if (antes.token === undefined) Deno.env.delete("UAZAPI_ADMIN_TOKEN");
    else Deno.env.set("UAZAPI_ADMIN_TOKEN", antes.token);
  });
}

Deno.test("mensagem que já está no banco não entra de novo", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: { "5895": CANAL_ATIVO },
      jaGravadas: ["5511:AAA"],
      eventos: [],
      claimsSoltos: [],
    };
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: deps(
        [{ name: "5895", token: "t", status: "connected" }],
        [mensagem("5511:AAA", HA_UMA_HORA)],
      ),
    });
    assertEquals(resumo.candidatas, 1);
    assertEquals(resumo.recuperadas, 0);
    assertEquals(estado.claimsSoltos, []);
    assertEquals(estado.eventos, []);
  }));

Deno.test("mensagem perdida entra e vira evento de alerta", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: { "5895": CANAL_ATIVO },
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
    };
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: deps(
        [{ name: "5895", token: "t", status: "connected" }],
        [mensagem("5511:BBB", HA_UMA_HORA)],
      ),
    });
    assertEquals(resumo.recuperadas, 1);
    assertEquals(resumo.degradado, false);
    // o claim sai pelo caminho que respeita a idade (delete com corte), nunca pelo cru
    assertEquals(estado.claimsSoltos, ["wa-ch-1-5511:BBB"]);
    assertEquals(estado.eventos.map((e) => e.event_type), ["inbound_recovered"]);
  }));

Deno.test("falha na consulta de já gravadas NÃO vira reingestão", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: { "5895": CANAL_ATIVO },
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
      erroNasGravadas: true,
    };
    let ingeriu = 0;
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: deps(
        [{ name: "5895", token: "t", status: "connected" }],
        [mensagem("5511:CCC", HA_UMA_HORA)],
        {
          ingerir: () => {
            ingeriu++;
            return Promise.resolve({ inserted: true });
          },
        },
      ),
    });
    assertEquals(ingeriu, 0);
    assertEquals(resumo.recuperadas, 0);
    assertEquals(resumo.falhas, 1);
    assertEquals(resumo.degradado, true);
  }));

Deno.test("instância desconectada e canal inativo ficam de fora", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: {
        "5895": CANAL_ATIVO,
        "matogrosso": { id: "ch-2", name: "mato grosso", status: "inactive" },
      },
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
    };
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: deps([
        { name: "5895", token: "t", status: "disconnected" },
        { name: "matogrosso", token: "t2", status: "connected" },
      ], [mensagem("5511:DDD", HA_UMA_HORA)]),
    });
    assertEquals(resumo.instancias, 2);
    assertEquals(resumo.conectadas, 1);
    assertEquals(resumo.semCanal, 1);
    assertEquals(resumo.comCanal, 0);
    assertEquals(resumo.recuperadas, 0);
  }));

Deno.test("erro numa instância não derruba a varredura das outras", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: { "5895": CANAL_ATIVO },
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
      erroNoCanal: true,
    };
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: deps([
        { name: "5895", token: "t", status: "connected" },
        { name: "6836", token: "t2", status: "connected" },
      ], [mensagem("5511:EEE", HA_UMA_HORA)]),
    });
    assertEquals(resumo.conectadas, 2);
    assertEquals(resumo.errosCanal, 2);
    assertEquals(resumo.degradado, true);
  }));

Deno.test("/instance/all vazio grava catchup_degradado em vez de sumir", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: {},
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
    };
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: {
        listarInstancias: () => Promise.resolve({ ok: false, status: 401, data: {} }),
      },
    });
    assertEquals(resumo.instanceAllVazio, true);
    assertEquals(resumo.degradado, true);
    assertEquals(estado.eventos.map((e) => e.event_type), ["catchup_degradado"]);
  }));

Deno.test("evento de alerta que falha vira falha, não silêncio", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: { "5895": CANAL_ATIVO },
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
      erroNoEvento: true,
    };
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: true,
      agora: AGORA,
      deps: deps(
        [{ name: "5895", token: "t", status: "connected" }],
        [mensagem("5511:FFF", HA_UMA_HORA)],
      ),
    });
    assertEquals(resumo.recuperadas, 1);
    assertEquals(resumo.falhas, 1);
    assertEquals(resumo.degradado, true);
  }));

Deno.test("simulação não grava nada e não encosta no claim", () =>
  comUazapiConfigurada(async () => {
    const estado: EstadoFalso = {
      canais: { "5895": CANAL_ATIVO },
      jaGravadas: [],
      eventos: [],
      claimsSoltos: [],
    };
    let ingeriu = 0;
    const { resumo } = await recuperarEntradaUazapi(dbFalso(estado), {
      apply: false,
      agora: AGORA,
      deps: deps(
        [{ name: "5895", token: "t", status: "connected" }],
        [mensagem("5511:GGG", HA_UMA_HORA)],
        {
          ingerir: () => {
            ingeriu++;
            return Promise.resolve({ inserted: true });
          },
        },
      ),
    });
    assertEquals(ingeriu, 0);
    assertEquals(estado.claimsSoltos, []);
    assertEquals(estado.eventos, []);
    assertEquals(resumo.recuperadas, 1);
  }));
