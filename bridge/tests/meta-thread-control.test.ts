import { isMetaThreadControlError } from "../shared/meta-errors.ts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

Deno.test("identifica bloqueio de controle de conversa da Meta", () => {
  assert(
    isMetaThreadControlError({
      error: {
        code: 10,
        error_subcode: 2018300,
        message: "Message failed because another app is controlling this thread",
      },
    }),
    "subcódigo 2018300 deve ser terminal",
  );
  assert(
    isMetaThreadControlError(
      "Error: outro app está controlando este tópico agora",
    ),
    "mensagem em português deve ser reconhecida",
  );
});
