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
