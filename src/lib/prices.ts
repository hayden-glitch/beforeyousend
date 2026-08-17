// Client-safe price constants for page copy. VITE_ vars are inlined by Vite at
// build time (read from .env / the build environment); the defaults must stay
// in sync with planCents() in server-api.ts so what a page shows always matches
// what Stripe charges. Change the price by setting VITE_PRICE_CONSULTATION_USD_CENTS
// (client copy) and PRICE_CONSULTATION_USD_CENTS (server checkout) — no code change.
export const consultationCents = Number(
  import.meta.env.VITE_PRICE_CONSULTATION_USD_CENTS || 3950
);
const money = (cents: number) =>
  `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
export const consultationMoney = money(consultationCents);
// Ultimate Co-Parent members get 20% off additional consultations.
export const consultationMemberMoney = money(
  Math.round(consultationCents * 0.8)
);
// One focused checkout step (smooth-payment slice): display data for the
// plan/product the dad selected. Prices mirror planCents()/the pricing page
// copy so what the step shows always matches what Stripe charges.
export type StepPlanKey =
  | "steady"
  | "command"
  | "ultimate"
  | "topup"
  | "consultation"
  | "gift"
  | "sortpile"
  | "attorney_prep_pack"
  | "record_review";
export type StepInterval = "month" | "year";
export function checkoutStepInfo(
  plan: StepPlanKey,
  interval: StepInterval,
  opts: { intro?: boolean } = {}
): { name: string; priceLabel: string; terms: string } {
  const oneTime: Record<string, { name: string; price: string; terms: string }> = {
    topup: { name: "Review Top-Up", price: "$9.50", terms: "One-time — 10 review credits. No expiry, stackable." },
    consultation: { name: "One Conversation", price: consultationMoney, terms: "One-time — 45 minutes, focused on your situation." },
    gift: { name: "Gift a Month", price: "$4.99", terms: "One-time — one month of Steady for another dad, delivered as a shareable code." },
    sortpile: { name: "Sort My Pile", price: "$19.50", terms: "One-time — up to 50 documents filed into your Organizer for you, with 30 days of the live Organizer included." },
    attorney_prep_pack: { name: "Attorney Prep Pack", price: "$24.50", terms: "One-time — your record, prepared for your attorney." },
    record_review: { name: "Record Review", price: "$29.50", terms: "One-time — a thorough read of your whole record. Not legal advice." },
  };
  if (oneTime[plan]) {
    const o = oneTime[plan];
    return { name: o.name, priceLabel: `${o.price} · one-time`, terms: o.terms };
  }
  const names: Record<string, string> = { steady: "Steady", command: "Command Center", ultimate: "Ultimate Co-Parent" };
  const monthlyCents: Record<string, number> = { steady: 499, command: 1249, ultimate: 2499 };
  const annualCents: Record<string, number> = { steady: 4990, command: 12490, ultimate: 24990 };
  const name = names[plan] || plan;
  if (plan === "ultimate" && interval === "month" && opts.intro) {
    return {
      name,
      priceLabel: "$19.99/mo × 3",
      terms: "First 3 months at the launch price, then $24.99/month. Cancel anytime.",
    };
  }
  if (interval === "year") {
    const v = money(annualCents[plan]);
    return { name, priceLabel: `${v}/year`, terms: `Renews once a year at ${v}. Cancel anytime.` };
  }
  const v = money(monthlyCents[plan]);
  return { name, priceLabel: `${v}/month`, terms: `Renews monthly at ${v}. Cancel anytime.` };
}
