import { canRecreateMissingOpening } from "../shared/funnel-state.ts";

Deno.test("repairs an existing sequence only when no opening delivery evidence exists", () => {
  const base = {
    requested: true,
    hasSequence: true,
    hasDeliveryEvidence: false,
  };
  if (!canRecreateMissingOpening(base)) {
    throw new Error(
      "an explicitly requested missing opening should be recoverable",
    );
  }
  if (canRecreateMissingOpening({ ...base, hasDeliveryEvidence: true })) {
    throw new Error(
      "any queue or outbound opening evidence must block recreation",
    );
  }
  if (canRecreateMissingOpening({ ...base, requested: false })) {
    throw new Error("repair must be explicitly requested");
  }
  if (canRecreateMissingOpening({ ...base, hasSequence: false })) {
    throw new Error("a new sequence does not need repair");
  }
});
