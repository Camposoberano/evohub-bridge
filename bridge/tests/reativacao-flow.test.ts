// Teste do flow de reativação (abridor oficial → vídeo → qualifica área → pacote → handoff).
// Cobre a parte PURA (flow.ts): validade e roteamento. O envio real do template e o disparo
// do pedido-humano são conferidos no teste ponta a ponta (ver plano), porque dependem de rede.
import {
  esperaResposta,
  type Flow,
  primeiroStep,
  resolveNext,
  stepById,
  stepsUntilWait,
  validateFlow,
} from "../shared/flow.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/** Mesma forma que o script de preparação monta (mantém os dois em sincronia). */
function flowReativacao(): Flow {
  const texto = (kg: number, cobre: string) => `Opção de ${kg} kg — atende ${cobre}.`;
  return {
    startId: "abertura",
    steps: [
      {
        id: "abertura",
        kind: "template",
        template: {
          name: "reativacao_video_2026",
          language: "pt_BR",
          headerMedia: { type: "image", url: "https://exemplo/header.jpg" },
        },
        fallbackNext: "video",
      },
      { id: "video", kind: "media", media: { type: "video", url: "https://exemplo/v.mp4" },
        text: "Olha o resultado", delaySeg: 1, next: "area" },
      { id: "area", kind: "list", text: "Qual área?",
        sections: [{ title: "Sua área", rows: [
          { id: "area_1", title: "1 hectare" },
          { id: "area_2", title: "2 hectares" },
          { id: "area_4", title: "4 hectares" },
          { id: "area_mais", title: "Mais de 4 hectares" },
        ] }],
        branches: { area_1: "pac1", area_2: "pac2", area_4: "pac4", area_mais: "maior" },
        fallbackNext: "maior" },
      { id: "pac1", kind: "text", text: texto(4, "1 hectare"), labels: ["interesse-video", "cotacao"],
        pedirHumano: true, handoffContexto: { area_hectares: 1, pacote_kg: 4 }, next: "fim" },
      { id: "pac2", kind: "text", text: texto(10, "2 hectares"), labels: ["interesse-video", "cotacao"],
        pedirHumano: true, handoffContexto: { area_hectares: 2, pacote_kg: 10 }, next: "fim" },
      { id: "pac4", kind: "text", text: texto(20, "4 hectares"), labels: ["interesse-video", "cotacao"],
        pedirHumano: true, handoffContexto: { area_hectares: 4, pacote_kg: 20 }, next: "fim" },
      { id: "maior", kind: "text", text: "Me diga quantos hectares e sua região.", labels: ["interesse-video", "cotacao"],
        pedirHumano: true, handoffContexto: { area_hectares: ">4" }, next: "fim" },
      { id: "fim", kind: "end" },
    ],
  };
}

Deno.test("flow de reativação é válido", () => {
  assertEquals(validateFlow(flowReativacao()), []);
});

Deno.test("abre pelo template e espera o clique", () => {
  const flow = flowReativacao();
  const inicio = primeiroStep(flow)!;
  assertEquals(inicio.id, "abertura");
  assertEquals(inicio.kind, "template");
  assert(esperaResposta(inicio), "template é step de espera");

  const { enviar, pararEm, fim } = stepsUntilWait(flow, "abertura");
  assertEquals(enviar.map((s) => s.id), ["abertura"]); // só o template sai agora
  assertEquals(pararEm?.id, "abertura");
  assertEquals(fim, false);
});

Deno.test("clique no template (sem id) manda vídeo e para na pergunta de área", () => {
  const flow = flowReativacao();
  const abertura = stepById(flow, "abertura")!;
  assertEquals(resolveNext(abertura, null), "video");

  const { enviar, pararEm } = stepsUntilWait(flow, "video");
  assertEquals(enviar.map((s) => s.id), ["video", "area"]); // vídeo + pergunta saem juntos
  assertEquals(pararEm?.id, "area"); // espera a escolha da área
});

Deno.test("cada área vai pro pacote certo e pede humano", () => {
  const flow = flowReativacao();
  const area = stepById(flow, "area")!;
  assertEquals(resolveNext(area, "area_1"), "pac1");
  assertEquals(resolveNext(area, "area_2"), "pac2");
  assertEquals(resolveNext(area, "area_4"), "pac4");
  assertEquals(resolveNext(area, "area_mais"), "maior");
  assertEquals(resolveNext(area, null), "maior"); // texto livre -> área a definir

  for (const id of ["pac1", "pac2", "pac4", "maior"]) {
    const s = stepById(flow, id)!;
    assertEquals(s.pedirHumano, true, `${id} deve pedir humano`);
    // o pacote é terminal: manda a mensagem e encerra (end), sem ficar esperando
    const { pararEm } = stepsUntilWait(flow, id);
    assertEquals(pararEm?.kind, "end");
  }
});

Deno.test("template sem name ou sem destino é recusado", () => {
  const ruim: Flow = {
    steps: [{ id: "t", kind: "template", template: { name: "" } }],
  };
  const problemas = validateFlow(ruim);
  assert(problemas.some((p) => /template sem name/.test(p.problema)));
  assert(problemas.some((p) => /sem fallbackNext/.test(p.problema)));
});
