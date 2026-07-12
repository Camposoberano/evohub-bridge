import { isDefaultAdMessage } from "../shared/ad-lead.ts";

Deno.test("recognizes common Portuguese ad message variations", () => {
  const samples = [
    "Olá! Posso ter mais informações sobre isso?",
    "Olá, gostaria de mais informações",
    "Tenho interesse e gostaria de mais informações sobre o produto",
  ];
  for (const sample of samples) {
    if (!isDefaultAdMessage(sample)) {
      throw new Error(`not recognized: ${sample}`);
    }
  }
});

Deno.test("does not enroll generic greetings", () => {
  for (const sample of ["bom dia", "boa noite", "oi tudo bem"]) {
    if (isDefaultAdMessage(sample)) {
      throw new Error(`generic greeting recognized: ${sample}`);
    }
  }
});
