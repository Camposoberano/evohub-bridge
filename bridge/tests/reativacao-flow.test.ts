// Teste do flow de reativação (abridor oficial por template -> vídeo -> CTA).
// Cobre só a parte PURA (flow.ts): validade e roteamento. O envio real do template pelo
// oficial é conferido no teste ponta a ponta com um número do dono (ver plano), porque
// enviarStep chama a Graph da Meta direto.
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
  return {
    startId: "abertura",
    steps: [
      {
        id: "abertura",
        kind: "template",
        template: {
          name: "reativacao_video_2026",
          language: "pt_BR",
          headerMedia: { type: "image", url: "https://exemplo/producao.jpg" },
        },
        // clique do template chega sem id de botão (type:"button") -> fallbackNext
        fallbackNext: "video",
      },
      {
        id: "video",
        kind: "media",
        media: { type: "video", url: "https://exemplo/video_3.mp4" },
        text: "Resultados reais no campo 👇",
        next: "cta",
      },
      {
        id: "cta",
        kind: "buttons",
        text: "Quer que eu veja o melhor pacote e preço pra sua área?",
        buttons: [
          { id: "cotar", title: "Quero cotação 💬" },
          { id: "depois", title: "Agora não" },
        ],
        branches: { cotar: "cotar", depois: "ack" },
        fallbackNext: "cotar",
      },
      {
        id: "cotar",
        kind: "text",
        text: "Perfeito! Já vou te passar pro nosso especialista. 👨‍🌾",
        labels: ["interesse-video"],
        next: "fim",
      },
      { id: "fim", kind: "end" },
      {
        id: "ack",
        kind: "text",
        text: "Tranquilo! Qualquer coisa é só me chamar. 👍",
        next: "fim2",
      },
      { id: "fim2", kind: "end" },
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

Deno.test("clique no template (sem id) cai no vídeo", () => {
  const flow = flowReativacao();
  const abertura = stepById(flow, "abertura")!;
  assertEquals(resolveNext(abertura, null), "video");

  // depois do vídeo, o CTA espera resposta e ramifica certo
  const { pararEm } = stepsUntilWait(flow, "video");
  assertEquals(pararEm?.id, "cta");
  const cta = stepById(flow, "cta")!;
  assertEquals(resolveNext(cta, "cotar"), "cotar");
  assertEquals(resolveNext(cta, "depois"), "ack");
});

Deno.test("template sem name ou sem destino é recusado", () => {
  const ruim: Flow = {
    steps: [{ id: "t", kind: "template", template: { name: "" } }],
  };
  const problemas = validateFlow(ruim);
  assert(problemas.some((p) => /template sem name/.test(p.problema)));
  assert(problemas.some((p) => /sem fallbackNext/.test(p.problema)));
});
