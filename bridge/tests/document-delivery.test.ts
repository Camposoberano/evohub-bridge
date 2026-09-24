import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideDocumentRoute,
  type FunnelDocumentInput,
} from "../shared/document-delivery.ts";
import type { HybridRoute } from "../shared/hybrid.ts";

const HYBRID: HybridRoute = {
  provider: "uazapi",
  instance: "5895",
  token: "test-token",
  channelId: "channel-test",
};

Deno.test("documento usa híbrido para destinatário brasileiro quando há rota", () => {
  assertEquals(
    decideDocumentRoute({ route: HYBRID, to: "5511910363320" }),
    "hybrid",
  );
});

Deno.test("documento usa oficial para destinatário que não é telefone brasileiro", () => {
  assertEquals(
    decideDocumentRoute({ route: HYBRID, to: "bsuid-abc" }),
    "official",
  );
});

Deno.test("documento usa oficial quando não há rota", () => {
  assertEquals(
    decideDocumentRoute({ route: null, to: "5511910363320" }),
    "official",
  );
});

Deno.test("contrato da entrega aceita etiqueta apenas quando declarada", () => {
  const isca: FunnelDocumentInput = {
    to: "5511910363320",
    mediaUrl: "https://example.invalid/isca.pdf",
    fileName: "isca.pdf",
    caption: "Material",
    registro: "[isca silagem] isca.pdf",
    labels: ["interesse-silagem"],
  };
  const plantio: FunnelDocumentInput = {
    ...isca,
    registro: "[PDF Instruções de Plantio]",
    labels: undefined,
  };
  assertEquals(isca.labels, ["interesse-silagem"]);
  assertEquals(plantio.labels, undefined);
});
