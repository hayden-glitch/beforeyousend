// @ts-nocheck — R6 root-cause probe (local only, never deployed).
// Proves whether `automatic_payment_methods` conflicts with the app's
// `managed_payments: { enabled: false }` checkout params on the owner's
// LIVE Stripe account (restricted key, apiVersion 2025-02-24.acacia).
// Uses inline price_data so NO price/product objects are created in the
// account. Creates Checkout Sessions only — never completes a payment.
// Run: bun stripe-probe.ts   (auto-loads .env)
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY || "";
const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });

const redact = (s: string) =>
  s
    .replace(/sk_(test|live)_[A-Za-z0-9]+/g, "sk_***REDACTED***")
    .replace(/rk_(test|live)_[A-Za-z0-9]+/g, "rk_***REDACTED***")
    .replace(/req_[A-Za-z0-9]{6,}/g, "req_***REDACTED***")
    .replace(/cs_(test|live)_[A-Za-z0-9]+/g, "cs_***REDACTED***");

function errInfo(e: any) {
  if (e?.type && e?.message) {
    return `type=${e.type} code=${e.code ?? "n/a"} msg=${redact(String(e.message))}`;
  }
  return redact(String(e?.message ?? e));
}

const base = {
  success_url: "https://beforeyousend.org/pricing?checkout=success&session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://beforeyousend.org/pricing?checkout=cancelled",
};
const subItem = {
  price_data: {
    currency: "usd",
    unit_amount: 499,
    product_data: { name: "R6 Probe (test) - recurring" },
    recurring: { interval: "month" },
  },
  quantity: 1,
};
const payItem = {
  price_data: {
    currency: "usd",
    unit_amount: 499,
    product_data: { name: "R6 Probe (test) - one-time" },
  },
  quantity: 1,
};

async function run() {
  // V1: SUBSCRIPTION mode + automatic_payment_methods + managed_payments:false
  //     == the exact params the three membership CTAs (Steady/Command/Ultimate)
  //     sent in the R6 preview build that Codex flagged as silently failing.
  try {
    const s = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [subItem],
      automatic_payment_methods: { enabled: true },
      managed_payments: { enabled: false },
      ...base,
    });
    console.log("V1 SUB+APM+managed_false: SUCCESS url=" + redact(s.url || ""));
  } catch (e) {
    console.log("V1 SUB+APM+managed_false: ERROR -> " + errInfo(e));
  }

  // V2: PAYMENT mode + APM + managed:false  == the one-time product params
  //     (topup / sortpile / attorney_prep_pack / record_review / gift).
  try {
    const s = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [payItem],
      automatic_payment_methods: { enabled: true },
      managed_payments: { enabled: false },
      ...base,
    });
    console.log("V2 PAY+APM+managed_false: SUCCESS url=" + redact(s.url || ""));
  } catch (e) {
    console.log("V2 PAY+APM+managed_false: ERROR -> " + errInfo(e));
  }

  // V3: SUBSCRIPTION mode WITHOUT automatic_payment_methods (the fix) == Steady
  try {
    const s = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [subItem],
      managed_payments: { enabled: false },
      ...base,
    });
    console.log("V3 SUB no-APM: SUCCESS url=" + redact(s.url || ""));
  } catch (e) {
    console.log("V3 SUB no-APM: ERROR -> " + errInfo(e));
  }

  // V4: PAYMENT mode WITHOUT automatic_payment_methods (the fix) == one-time
  try {
    const s = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [payItem],
      managed_payments: { enabled: false },
      ...base,
    });
    console.log("V4 PAY no-APM: SUCCESS url=" + redact(s.url || ""));
  } catch (e) {
    console.log("V4 PAY no-APM: ERROR -> " + errInfo(e));
  }

  // V5: SUBSCRIPTION mode, no APM, NO managed_payments at all (baseline sanity)
  try {
    const s = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [subItem],
      ...base,
    });
    console.log("V5 SUB bare: SUCCESS url=" + redact(s.url || ""));
  } catch (e) {
    console.log("V5 SUB bare: ERROR -> " + errInfo(e));
  }
}

run().then(() => process.exit(0));
