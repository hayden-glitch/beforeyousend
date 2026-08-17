import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { isCleanQueryParam, track } from "~/lib/analytics";
import { recordSurface, markPurchasedThisSession } from "~/lib/offer";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import { consultationCents, consultationMemberMoney, consultationMoney } from "~/lib/prices";
import { seoHead } from "~/lib/seo";
import { markConfirmPending, runCheckout } from "~/lib/checkout";

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
  // Where the sign-in link should return the user. Built from the captured
  // Stripe-return URL so checkout=success&plan=consultation&session_id=...
  // survives the login round-trip and the mount effect below re-fires
  // /api/checkout/confirm automatically (mirrors the pricing page's 401
  // handling).
  const [needLoginHref, setNeedLoginHref] = useState("/login?next=/consultations");
  // P0 hotfix (work order 5300912458): capture the Stripe-return payload and
  // the full return continuation ONCE at first render — BEFORE the mount
  // effect scrubs checkout/session_id/plan out of the visible URL. The async
  // confirm + 401 handlers MUST use these captured values, never
  // window.location.search after the replaceState (previously the scrub ran
  // synchronously before the confirm response resolved, so a logged-out
  // checkout return built its login href from the ALREADY-CLEANED URL and the
  // session_id was lost — the purchase could never be linked on the round-trip).
  const returnRef = useRef<{
    result: string | null;
    plan: string | null;
    sessionId: string | null;
    continuation: string;
  } | null>(null);
  if (returnRef.current === null && typeof window !== "undefined") {
    const query = new URLSearchParams(location.search);
    // A Stripe success return owns this load — hold the checkout resumer
    // (__root) off while the confirm round-trip is pending.
    if (query.get("checkout") === "success") markConfirmPending();
    returnRef.current = {
      result: query.get("checkout"),
      plan: query.get("plan"),
      sessionId: query.get("session_id"),
      continuation: location.pathname + location.search,
    };
  }

  useEffect(() => {
    track("consultation_viewed", {});
    // P0 hotfix: scrub the Stripe return params out of the visible URL
    // IMMEDIATELY (before the confirm round-trip and before the root analytics
    // effect initializes measurement) so session_id never lingers in the
    // address bar or any later analytics capture. Exact known UI values and
    // ad-attribution params survive; everything else non-attribution is
    // dropped. The captured returnRef is the single source of truth for the
    // confirm payload and the login continuation.
    const cleanCheckoutUrl = () => {
      try {
        const clean = new URLSearchParams();
        const qq = new URLSearchParams(window.location.search);
        for (const [k, v] of qq) { if (isCleanQueryParam(k, v)) clean.set(k, v); }
        const s = clean.toString();
        window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
      } catch { /* noop */ }
    };
    cleanCheckoutUrl();
    const snap = returnRef.current;
    if (snap?.result === "success" && snap.plan === "consultation" && snap.sessionId) {
      markPurchasedThisSession();
      fetch("/api/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: snap.sessionId }),
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
            // P0 hotfix: the continuation is the CAPTURED pre-scrub URL —
            // window.location.search is already clean by the time the 401
            // resolves and would drop session_id.
            setNeedLogin(true);
            setNeedLoginHref(`/login?next=${encodeURIComponent(snap.continuation)}`);
            setMessage("Your purchase went through — sign in to link it to your account.");
          } else {
            setMessage(j.error || "We couldn't confirm your purchase yet — it may take a minute.");
          }
        })
        .catch(() => setMessage("We couldn't confirm your purchase yet — it may take a minute."));
    } else if (snap?.result === "cancelled") {
      recordSurface("checkout_return");
    } else {
      recordSurface("consultations");
    }
  }, []);

  // ONE checkout path — the shared coordinator (lib/checkout.ts) owns auth
  // resolution, intent persistence, login routing, and the ref lock. Signed-
  // out taps persist the intent and go straight to /login?next=/consultations;
  // after sign-in the __root resumer re-runs this exact checkout.
  async function checkout() {
    setMessage("");
    const outcome = await runCheckout({
      plan: "consultation",
      source: "consultations",
      setBusy,
      onError: (m) => setMessage(m || "Checkout is not available right now. Please try again soon."),
    });
    if (outcome.state === "opening" && outcome.url) location.href = outcome.url;
  }

  // Errors raised by a RESUMED checkout land in the same message slot.
  useEffect(() => {
    const onErr = (e: Event) => setMessage((e as CustomEvent<string>).detail || "Checkout is not available right now. Please try again soon.");
    window.addEventListener("bys:checkout-error", onErr as EventListener);
    return () => window.removeEventListener("bys:checkout-error", onErr as EventListener);
  }, []);

  return <div className="min-h-dvh">
    <SiteHeader active="consultations" />
    <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-5 pb-16 pt-12 sm:pt-16">
      {purchased && (
        <div className="mb-8 rounded-xl border border-forest/25 bg-forest p-6 text-cream">
          <p className="font-display text-xl font-semibold">You're in — we'll contact you to schedule your 45-minute session.</p>
        </div>
      )}
      {needLogin && (
        <a href={needLoginHref} className="btn-primary mb-8 block w-full text-center sm:w-auto">
          Sign in to link your purchase →
        </a>
      )}
      {returnRef.current?.result === "cancelled" && (
        <div className="mb-8 rounded-xl border border-line bg-card p-5 text-base text-stone">No problem — nothing was charged. You can come back whenever you're ready.</div>
      )}

      <section>
        <h1 className="max-w-xl font-display text-[2.4rem] font-semibold leading-[1.06] tracking-tight text-ink sm:text-5xl">
          One honest conversation.
        </h1>
        <p className="mt-4 max-w-xl text-lg leading-relaxed text-stone">
          45 minutes, one time — calmer ways to handle real exchanges, what to keep, and better questions for your professionals.
        </p>
        <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-4xl font-semibold text-ink">${money(consultationCents)}</span>
          <span className="text-base text-stone">one time · no subscription required</span>
        </div>
        <button onClick={checkout} disabled={busy} className="btn-primary mt-7 w-full text-lg sm:w-auto">{busy ? "Opening checkout…" : `Book your consultation — ${consultationMoney}`}</button>
        <p className="mt-3 text-sm text-stone">Ultimate Co-Parent members get 20% off additional consultations ({consultationMemberMoney}) and priority scheduling.</p>
        <p className="mt-3 text-sm text-stone">Not therapy, and not legal advice — practical perspective, organized around your situation.</p>
        {message && <p role="status" className="mt-4 rounded-xl bg-cream-deep px-5 py-4 text-base text-stone">{message}</p>}
      </section>

      <section className="mt-12 max-w-xl border-t border-line pt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">What we'll work through</h2>
        <div className="mt-4 divide-y divide-line">
          {[
            ["Communication habits", "Calmer, clearer ways to handle difficult exchanges."],
            ["Documentation & organization", "What to keep, sort, and find faster."],
            ["Better questions", "Focused questions for your attorney or other professionals."],
          ].map(([title, text]) => (
            <div key={title} className="py-3.5">
              <h3 className="text-base font-semibold text-ink">{title}</h3>
              <p className="mt-0.5 text-base leading-relaxed text-stone">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 max-w-xl border-t border-line pt-8">
        <h2 className="font-display text-2xl font-semibold text-ink">How it works</h2>
        <ol className="mt-4 space-y-3">
          {[
            ["1", "Buy", "Choose the one-time consultation."],
            ["2", "Schedule", "We'll contact you to schedule."],
            ["3", "Talk", "Have your 45-minute conversation."],
          ].map(([num, title, text]) => (
            <li key={num} className="flex items-baseline gap-3">
              <span className="w-6 shrink-0 text-base font-semibold text-bronze">{num}</span>
              <div>
                <h3 className="inline text-base font-semibold text-ink">{title} — </h3>
                <p className="inline text-base leading-relaxed text-stone">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-10 text-base leading-relaxed text-stone">This is not legal advice or legal representation, and no outcome is guaranteed. For legal questions, consult a licensed attorney.</p>
    </main>
    <SiteFooter />
  </div>;
}
