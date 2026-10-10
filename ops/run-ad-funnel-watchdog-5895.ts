import { reconcileNewAdFunnels } from "../bridge/shared/ad-funnel-watchdog.ts";

console.log(JSON.stringify(await reconcileNewAdFunnels()));
