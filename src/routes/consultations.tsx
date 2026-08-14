import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import { recordSurface, markPurchasedThisSession } from "~/lib/offer";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import { consultationCents, consultationMemberMoney, consultationMoney } from "~/lib/prices";
import { seoHead } from "~/lib/seo";

export const Route = createFileRoute("/consultations")({
  head: () => ({
    ...seoHead({
      title: "Consultations — Before You Send",
      description: "A one-time 45-minute consultation for your situation: calmer ways to handle real exchanges, what to keep, and better questions for your professionals.",
      path: "/consultations",
    }),
  }),
  component: Consultations,
});

const money = (cents: number) => `${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

function Consultations() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [purchased, setPurchased] = useState(false); // verified paid + linked to an account
  const [needLogin, setNeedLogin] = useState(false);
  // Where the sign-in link should return the user. Built from the live URL so
  // checkout=success&plan=consultation&session_id=... survives the login
  // round-trip and the mount effect below re-fires /api/checkout/confirm
  // automatically (mirrors the pricing page's 401 handling).
  const [needLoginHref, setNeedLoginHref] = useState("/login?next=/consultations");
  const query = typeof window !== "undefined" ? new URLSearchParams(location.search) : null;
  const result = query?.get("checkout");
  const plan = query?.get("plan");

  useEffect(() => {
    track("consultation_viewed", {});
    // Track A (Codex consolidated order §3): scrub the Stripe return params
    // from the URL after the confirm flow resolves so session_id never lingers
    // in the address bar or any later analytics capture. The 401 "sign in to
    // link" href is built from the raw URL BEFORE this runs.
    const cleanCheckoutUrl = () => {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch { /* noop */ }
    };
    if (result === "success" && plan === "consultation" && query?.get("session_id")) {
      markPurchasedThisSession();
      fetch("/api/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: query.get("session_id") }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (r.ok) {
            // Verified paid + linked — only now show the success state.
            track("consultation_purchased", {});
            setPurchased(true);
          } else if (r.status === 401) {
            // Logged-out checkout return: the purchase went through but isn't
            // linked yet. Keep the checkout params in ?next= so login returns
            // here and the confirm effect re-fires, linking it automatically.
            setNeedLogin(true);
            setNeedLoginHref(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            setMessage("Your purchase went through — sign in to link it to your account.");
          } else {
            setMessage(j.error || "We couldn't confirm your purchase yet — it may take a minute.");
          }
        })
        .catch(() => setMessage("We couldn't confirm your purchase yet — it may take a minute."));
      cleanCheckoutUrl();
    } else if (result === "cancelled") {
      recordSurface("checkout_return");
      cleanCheckoutUrl();
    } else {
      recordSurface("consultations");
    }
  }, []);

  async function checkout() {
    setBusy(true); setMessage(""); track("checkout_started", { plan: "consultation" });
    try {
      const r = await fetch("/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: "consultation" }) });
      const data = await r.json();
      if (!r.ok) { setMessage(data.error || "Checkout is not available right now. Please try again soon."); setBusy(false); return; }
      if (data.url) location.href = data.url;
      else { setMessage("Checkout is not available right now. Please try again soon."); setBusy(false); }
    } catch { setMessage("Checkout is not available right now. Please try again soon."); setBusy(false); }
  }

  return <div className="min-h-dvh">
    <SiteHeader active="consultations" />
    <main id="main" tabIndex={-1} className="mx-auto max-w-4xl px-5 pb-16 pt-12 sm:pt-16">
      {purchased && <div className="mb-8 rounded-3xl border border-forest/20 bg-forest p-6 text-cream"><p className="font-display text-2xl font-semibold">You’re in — we’ll contact you to schedule your 45-minute session.</p></div>}
      {needLogin && (
        <a href={needLoginHref} className="btn-primary mb-8 block w-full text-center sm:w-auto">
          Sign in to link your purchase →
        </a>
      )}
      {result === "cancelled" && <div className="mb-8 rounded-3xl border border-line bg-card p-5 text-base text-stone">No problem — nothing was charged. You can come back whenever you’re ready.</div>}
      <section><p className="text-base font-semibold uppercase tracking-[.16em] text-forest-soft">Practical perspective for your situation</p><h1 className="mt-3 max-w-2xl font-display text-[2.7rem] font-semibold leading-[1.06] tracking-tight text-forest sm:text-5xl">Your situation. One honest conversation. A clearer next step.</h1><p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone">Bring your messages, records, and questions. Leave with calmer ways to handle the exchanges you’re having, a plan for what to keep, and better questions for your professionals. No pressure. One conversation.</p><div className="mt-7 flex flex-wrap items-baseline gap-x-4 gap-y-1"><span className="font-display text-4xl font-semibold text-forest">${money(consultationCents)}</span><span className="text-base text-stone">one time · 45 minutes · no subscription required</span></div><button onClick={checkout} disabled={busy} className="btn-primary mt-7 w-full text-lg sm:w-auto">{busy ? "Opening checkout…" : `Book your consultation — ${consultationMoney}`}</button><p className="mt-3 text-sm text-stone">Ultimate Co-Parent members get 20% off additional consultations ({consultationMemberMoney}) and priority scheduling.</p><p className="mt-3 text-sm text-stone">Said plainly: this isn't therapy, and it isn't legal advice. It's practical perspective, organized around your situation.</p>{message && <p role="status" className="mt-4 rounded-2xl bg-cream-deep px-5 py-4 text-base text-stone">{message}</p>}</section>
      <section className="mt-14"><h2 className="font-display text-3xl font-semibold text-forest">What we’ll work through</h2><div className="mt-5 grid gap-4 sm:grid-cols-3">{[["Communication habits","Find calmer, clearer ways to handle difficult exchanges."],["Documentation & organization","What to keep, sort, and find faster."],["Better questions","Prepare focused questions for your attorney or other professionals." ]].map(([title, text]) => <article key={title} className="rounded-3xl border border-line bg-card p-5 shadow-card transition md:hover:border-forest/30"><h3 className="text-lg font-semibold text-forest">{title}</h3><p className="mt-2 text-base leading-relaxed text-stone">{text}</p></article>)}</div></section>
      <section className="mt-14 rounded-[2rem] border border-line bg-cream-deep/60 p-6 sm:p-8"><h2 className="font-display text-3xl font-semibold text-forest">How it works</h2><ol className="mt-5 grid gap-5 sm:grid-cols-3">{[["1","Buy","Choose the one-time consultation."],["2","Schedule","We’ll contact you to schedule."],["3","Talk","Have your 45-minute conversation."]].map(([num, title, text]) => <li key={num} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest font-semibold text-cream">{num}</span><div><h3 className="font-semibold text-forest">{title}</h3><p className="mt-1 text-base leading-relaxed text-stone">{text}</p></div></li>)}</ol></section>
      <p className="mt-14 text-base leading-relaxed text-stone">This is not legal advice or legal representation, and no outcome is guaranteed. For legal questions, consult a licensed attorney.</p>
    </main>
    <SiteFooter />
  </div>;
}
