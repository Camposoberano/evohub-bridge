import {
  deferredAdRoute,
  isAdFunnelOriginSignal,
  isDefaultAdMessage,
  shouldDeferInitialAdIntent,
} from "../shared/ad-lead.ts";

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

Deno.test("ad origin gets the opening before any detected route", () => {
  for (
    const signal of [
      "meta_referral",
      "persisted_ad_origin",
      "default_ad_message",
      "social_opening",
    ]
  ) {
    if (!isAdFunnelOriginSignal(signal)) {
      throw new Error(`ad origin not recognized: ${signal}`);
    }
    if (!shouldDeferInitialAdIntent(signal, "created")) {
      throw new Error(`first route was not deferred: ${signal}`);
    }
    if (!shouldDeferInitialAdIntent(signal, "in_progress")) {
      throw new Error(`concurrent opening was not protected: ${signal}`);
    }
    if (shouldDeferInitialAdIntent(signal, "already")) {
      throw new Error(`existing sequence was incorrectly deferred: ${signal}`);
    }
  }
  if (isAdFunnelOriginSignal("configured_keyword")) {
    throw new Error("configured keyword was treated as ad provenance");
  }
  if (shouldDeferInitialAdIntent("configured_keyword", "created")) {
    throw new Error("non-ad fallback incorrectly deferred its route");
  }
});

Deno.test("initial ad intent is retained for a route after the opening", () => {
  if (deferredAdRoute("Qual é o preço das sementes?") !== "menu_preco") {
    throw new Error("price intent should be queued after the ad opening");
  }
  if (deferredAdRoute("Você entrega em todo o Brasil?") !== "menu_humano") {
    throw new Error("unknown ad question should be queued for later handoff");
  }
  if (
    deferredAdRoute("Vocês oferecem entrega em todo o Brasil") !== "menu_humano"
  ) {
    throw new Error(
      "ad logistics question without punctuation was not retained",
    );
  }
  if (deferredAdRoute("Boa tarde") !== null) {
    throw new Error("a greeting should not enqueue a secondary route");
  }
});
