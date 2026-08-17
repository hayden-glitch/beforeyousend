// test-custom-checkout.mjs — guard tests for the smooth-payment slice.
// Runs against the SOURCE (bun runs TS natively); exercises ONLY the gating
// layers of /api/checkout/custom — nothing here creates a Stripe session or
// touches the database. Run after `bun run build`:
//   cd /home/team/shared/site && . ./.env && bun scripts/test-custom-checkout.mjs
import { __trackB } from "../src/lib/server-api";
const { customCheckoutKeyMode, handleCustomCheckout } = __trackB;

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("FAIL " + name); }
}

// 1. Test-mode-only detection (pure).
check("customCheckoutKeyMode('') -> none", customCheckoutKeyMode("") === "none");
check("customCheckoutKeyMode('sk_live_x') -> live", customCheckoutKeyMode("sk_live_x") === "live");
check("customCheckoutKeyMode('rk_live_x') -> live", customCheckoutKeyMode("rk_live_x") === "live");
check("customCheckoutKeyMode('sk_test_x') -> test", customCheckoutKeyMode("sk_test_x") === "test");
check("customCheckoutKeyMode('rk_test_x') -> test", customCheckoutKeyMode("rk_test_x") === "test");

const req = (body) =>
  new Request("https://example.com/api/checkout/custom", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// 2. QA guard blocks session creation in previews, even with a test key.
process.env.BYS_PAYMENTS_QA_GUARD = "true";
process.env.STRIPE_SECRET_KEY = "sk_test_x";
let r = await handleCustomCheckout(req({ plan: "steady", interval: "month" }));
let j = await r.json();
check("QA guard on -> 503 payments_disabled", r.status === 503 && j.payments_disabled === true);

// 3. Live key refused (guard off) — the slice must never run against live.
process.env.BYS_PAYMENTS_QA_GUARD = "false";
process.env.STRIPE_SECRET_KEY = "rk_live_x";
r = await handleCustomCheckout(req({ plan: "steady", interval: "month" }));
j = await r.json();
check("live key -> 503 custom_unavailable", r.status === 503 && j.custom_unavailable === true);

// 4. Test key + signed-out -> 401 login_required BEFORE any Stripe call.
process.env.STRIPE_SECRET_KEY = "sk_test_x";
r = await handleCustomCheckout(req({ plan: "steady", interval: "month" }));
j = await r.json();
check("test key + signed out -> 401 login_required", r.status === 401 && j.login_required === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
