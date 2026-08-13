import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import { recordSurface, markPurchasedThisSession, offerAccepted, purchasedThisSession, valueDelivered } from "~/lib/offer";
import { IconCheck, IconChevronDown } from "~/components/icons";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import { consultationMoney } from "~/lib/prices";
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute("/pricing")({
  head: () => ({
    ...seoHead({
      title: "Pricing — Before You Send",
      description: "Free, Steady, Command Center, and Ultimate plans — starting with a review that's always free. No pressure, cancel anytime.",
      path: "/pricing",
    }),
  }),
  component: Pricing,
});
type PlanKey = "steady" | "command" | "ultimate";
type Interval = "month" | "year";
type Tab = "Memberships" | "One-time" | "Compare" | "FAQ";
const monthly = { steady: 499, command: 1249, ultimate: 2499 };
const annual = { steady: 4990, command: 12490, ultimate: 24990 };
const money = (n: number) => "$" + (n / 100).toFixed(2).replace(/\.00$/, "");
// Plan order matches COMPARE_ROWS (Free → Steady → Command → Ultimate — value
// first, never decoy-before-value; Ultimate keeps its "Recommended" hero card).
const PLANS: [PlanKey | "free", string, string, string[]][] = [
  ["free", "Free", "Start calm, stay consistent.", ["First review always free — no account", "5 reviews per month with an account", "Saved history (last 10)", "Unlimited Communication Log + Timeline"]],
  ["steady", "Steady", "Calmer communication, month after month.", ["30 message reviews per month", "Unlimited review history", "Unlimited Communication Log and Timeline", "Email support from a real person"]],
  ["command", "Command Center", "Your complete organizing system — live today.", ["Unlimited message reviews", "Document Organizer + smart tagging", "Case Summary — from your saved record", "Action Center — what needs your attention", "Export pack"]],
  ["ultimate", "Ultimate Co-Parent", "Everything we offer. One plan. Set up for you.", ["Unlimited message reviews", "Everything in Command Center", `1 free 45-minute consultation each year (${consultationMoney} value)`, "All one-time packs included", "Priority support + scheduling", "Kickstart onboarding and early access"]],
];
const TIER_NAMES: Record<string, string> = { steady: "Steady", command: "Command Center", ultimate: "Ultimate Co-Parent" };
// [name, price, delivery line, includedInUltimate] — LIVE one-time products.
const ONETIME: [string, string, string, boolean][] = [
  ["One Conversation", consultationMoney, "45 minutes focused on your situation.", false],
  ["Review Top-Up", "$9.50", "10 review credits; no expiry, stackable.", true],
  ["Gift a month of Steady", "$4.99", "One month of Steady for another dad, delivered as a code you can share.", true],
  ["Sort My Pile", "$19.50", "Up to 50 documents filed into your Organizer folders for you — with 30 days of the live Organizer included.", true],
  ["Attorney Prep Pack", "$24.50", "Your record, prepared for your attorney — cover sheet, chronology, evidence index, and more. Generated from your record.", true],
  ["Record Review", "$29.50", "A calm, thorough read of your whole record — patterns, evidence strengths, and what to document next. Not legal advice.", true],
];
const COMPARE_ROWS: [string, string, string, string, string][] = [
  ["Reviews", "5/mo", "30/mo", "Unlimited", "Unlimited"],
  ["Saved history", "Last 10", "Unlimited", "Unlimited", "Unlimited"],
  ["Communication Log", "Unlimited", "Unlimited", "Unlimited", "Unlimited"],
  ["Event Timeline", "Unlimited", "Unlimited", "Unlimited", "Unlimited"],
  ["Document Organizer", "—", "—", "Included", "Included"],
  ["Case Summary", "—", "—", "Included", "Included"],
  ["Action Center", "—", "—", "Included", "Included"],
  ["Export pack", "—", "—", "Included", "Included"],
  ["Attorney Prep Pack", "—", "—", "—", "Included"],
  ["Consultations", "—", "—", "—", "1/year included"],
  ["Record Review", "—", "—", "—", "1/year included"],
  ["Priority support", "—", "—", "—", "Included"],
  ["Early access + kickstart", "—", "—", "—", "Included"],
];

function Pricing() {
  // ?tab= deep link (Tools cards send ?tab=One-time so an upsell lands on the
  // right pricing section; the attorney-prep-pack branch uses the same param).
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      return t === "One-time" || t === "Compare" || t === "FAQ" ? (t as Tab) : "Memberships";
    } catch {
      return "Memberships";
    }
  });
  const [isAnnual, setAnnual] = useState(false); // Monthly is the default (owner direction)
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [isUltimate, setIsUltimate] = useState(false);
  const [attorneyPrepOwned, setAttorneyPrepOwned] = useState(false);
  // Record Review entitlement shape from /api/auth/me: { entitled, kind:
  // 'ultimate'|'purchased'|'none', nextAvailableAt? } — server-side authority.
  const [recordReview, setRecordReview] = useState<{ entitled?: boolean; kind?: string } | null>(null);
  const [purchased, setPurchased] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [checkinActive, setCheckinActive] = useState(false); // ?checkin=50 (Co-Parent Check-In offer)
  const [myTier, setMyTier] = useState("free");
  const [giftCode, setGiftCode] = useState("");
  const [giftCopied, setGiftCopied] = useState(false);
  // Where the sign-in link should return the user. Built from the live URL so
  // checkout=success&plan=...&session_id=... survives the login round-trip and
  // the mount effect below re-fires /api/checkout/confirm automatically.
  const [needLoginHref, setNeedLoginHref] = useState("/login?next=/pricing");

  useEffect(() => {
    track("pricing_viewed", {});
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((j) => { setIsUltimate(j.user?.profile?.tier === "ultimate"); setMyTier(j.quota?.tier || j.user?.profile?.tier || "free"); setAttorneyPrepOwned(!!j.entitlements?.attorneyPrep); setRecordReview(j.entitlements?.recordReview || { entitled: false, kind: "none" }); })
      .catch(() => {});
    const q = new URLSearchParams(window.location.search);
    setCheckinActive(q.get("checkin") === "50");
    if (q.get("tab") === "One-time") setTab("One-time");
    if (q.get("checkout") === "success" && q.get("session_id")) {
      // Checkout return — record the purchase (suppresses the offer this session).
      markPurchasedThisSession();
      const plan = q.get("plan") || "";
      fetch("/api/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: q.get("session_id") }),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (r.ok) {
            if (plan === "gift" && !j.kind) {
              // Reload after an already-processed gift purchase: recover the
              // code from /api/gifts/my (single code per paid session).
              const gm = await fetch("/api/gifts/my").then((rr) => (rr.ok ? rr.json() : null)).catch(() => null);
              if (gm?.codes?.length) {
                setGiftCode(gm.codes[0].code);
                track("gift_code_created", { plan: myTier });
              } else {
                setMsg("Your gift purchase was confirmed.");
              }
              setPurchased(true);
            } else if (j.kind === "gift") {
              setGiftCode(j.gift.code);
              track("gift_code_created", { plan: myTier });
              setPurchased(true);
            } else if (j.kind === "topup") {
              setMsg(`${j.credits} review credits added to your account. They never expire.`);
              track("topup_purchased", {});
            } else if (j.kind === "sortpile") {
              // Purchase confirmed — guide the dad straight into the flow.
              track("sortpile_purchase", { plan: "sortpile" });
              window.location.href = "/home?tab=organizer&sort=1";
            } else if (j.kind === "attorney_prep_pack") {
              setMsg("Attorney Prep Pack unlocked — it's saved to your account.");
              track("attorney_prep_pack_purchase", { plan: "attorney_prep_pack" });
              setAttorneyPrepOwned(true);
              setPurchased(true);
            } else if (j.kind === "record_review") {
              setMsg("Record Review unlocked — it's saved to your account.");
              track("record_review_purchase", { plan: "record_review" });
              setRecordReview({ entitled: true, kind: "purchased" });
              setPurchased(true);
            } else if (j.tier) {
              setMsg(`Welcome to ${TIER_NAMES[j.tier] || j.tier} — your plan is active.`);
              track("subscription_purchased", { plan, tier: j.tier, intro: !!j.introOffer });
              setPurchased(true);
              // Purchase confirmed — the special offer is genuinely accepted now
              // (never mark it accepted on a mere checkout start).
              window.dispatchEvent(new CustomEvent("bys:offer-accepted"));
              if (j.tier === "ultimate") setIsUltimate(true);
            } else {
              setMsg("Purchase confirmed — thank you.");
              setPurchased(true);
            }
          } else {
            if (r.status === 401) {
              // Logged-out checkout return: link the purchase to an account.
              // Keep the checkout params in the ?next= so login returns here and
              // the confirm effect re-fires, linking the purchase automatically.
              setNeedLogin(true);
              setNeedLoginHref(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
              setMsg("Your purchase went through — sign in to link it to your account.");
            } else {
              setMsg(j.error || "We couldn't confirm your purchase yet — it may take a minute.");
            }
          }
        })
        .catch(() => setMsg("We couldn't confirm your purchase yet — it may take a minute."));
    } else if (q.get("checkout") === "cancelled") {
      recordSurface("checkout_return");
      setMsg("No problem — nothing was charged. Come back whenever you're ready.");
    } else {
      recordSurface("pricing");
    }
  }, []);

  async function checkout(plan: PlanKey | "topup" | "consultation" | "gift" | "sortpile" | "attorney_prep_pack" | "record_review", interval: Interval = "month") {
    setBusy(`${plan}${interval}`);
    setMsg("");
    track("checkout_started", { plan, interval, ...(checkinActive ? { source: "checkin" } : {}) });
    try {
      if (plan === "gift") {
        const r = await fetch("/api/gifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const d = await r.json();
        if (r.status === 401) {
          // L4: a signed-out dad buying a gift gets the same login redirect the
          // confirm flow uses — keep the pricing page in ?next= so he returns.
          setNeedLogin(true);
          setNeedLoginHref(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          setMsg("Sign in to buy a gift month — it's linked to your account.");
          setBusy("");
          return;
        }
        if (d.url) location.href = d.url;
        else setMsg(d.error || "Checkout is not available right now.");
        setBusy("");
        return;
      }
      // Monthly Ultimate always carries the launch intro rate (3 months at $19.99) —
      // the same honest deal the Special Offer modal offers, stated on the card.
      // With the Check-In offer active, the coupon replaces the intro schedule.
      const offer = plan === "ultimate" && interval === "month" && !checkinActive;
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, interval, offer, ...(checkinActive && interval === "month" ? { checkin: true } : {}) }),
      });
      const d = await r.json();
      if (d.url) location.href = d.url;
      else setMsg(d.error || "Checkout is not available right now.");
    } catch {
      setMsg("Checkout is not available right now.");
    }
    setBusy("");
  }

  const price = (p: PlanKey) => (isAnnual ? annual[p] : monthly[p]);

  // Gift code card actions: copy the code or a /redeem?code= link. Honest —
  // the dad shares it himself through his own channel; we never post anywhere.
  const giftCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (giftCopyTimer.current) clearTimeout(giftCopyTimer.current); }, []);
  async function copyGiftCode() {
    if (!giftCode) return;
    try {
      await navigator.clipboard.writeText(giftCode);
      track("gift_share", { plan: myTier });
      setGiftCopied(true);
      if (giftCopyTimer.current) clearTimeout(giftCopyTimer.current);
      giftCopyTimer.current = setTimeout(() => setGiftCopied(false), 3000);
    } catch { /* clipboard unavailable — code stays visible to copy manually */ }
  }
  async function shareGiftLink() {
    if (!giftCode) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/redeem?code=${encodeURIComponent(giftCode)}`);
      track("gift_share", { plan: myTier });
      setGiftCopied(true);
      if (giftCopyTimer.current) clearTimeout(giftCopyTimer.current);
      giftCopyTimer.current = setTimeout(() => setGiftCopied(false), 3000);
    } catch { /* clipboard unavailable — link stays visible */ }
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader active="pricing" />
      <main className="mx-auto max-w-5xl px-5 pb-32 pt-12">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Simple, honest pricing</p>
        <h1 className="mt-3 max-w-3xl font-display text-[2.65rem] font-semibold leading-[1.06] text-forest sm:text-5xl">
          Your calm, your record, your peace — for less than a dinner out.
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-stone">
          Every plan starts with a free review that always stays free. Upgrade when the record starts to matter more.
        </p>
        <nav role="tablist" aria-label="Pricing sections" className="sticky top-16 z-10 mt-8 flex flex-wrap gap-1 border-y border-line bg-cream py-2">
          {(["Memberships", "One-time", "Compare", "FAQ"] as Tab[]).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={`min-h-11 whitespace-nowrap rounded-full px-3 py-2 font-semibold ${tab === x ? "bg-forest text-cream" : "text-forest"}`}>
              {x}
            </button>
          ))}
        </nav>

        {tab === "Memberships" && (
          <>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full border border-line bg-card p-1">
                <button aria-pressed={!isAnnual} onClick={() => setAnnual(false)} className={`min-h-11 rounded-full px-5 py-2 font-semibold ${!isAnnual ? "bg-forest text-cream" : "text-forest"}`}>Monthly</button>
                <button aria-pressed={isAnnual} onClick={() => setAnnual(true)} className={`min-h-11 rounded-full px-5 py-2 font-semibold ${isAnnual ? "bg-forest text-cream" : "text-forest"}`}>Annual</button>
              </div>
              {isAnnual && <span className="font-semibold text-forest">2 months free — 10 months for the price of 12</span>}
            </div>

            {/* Co-Parent Check-In offer banner — arrived via ?checkin=50.
                First 3 months at half price on monthly plans. Honest, no countdown. */}
            {checkinActive && (
              <div className="mt-6 rounded-2xl border border-forest/25 bg-cream-deep/70 px-5 py-4 text-base text-forest">
                You have the Check-In offer — your first 3 months at half price on monthly plans.
              </div>
            )}

            {/* Free / Steady / Command grid — value first (audit TOP-10 #5: plan
                order matches COMPARE_ROWS, no decoy-before-value) */}
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {PLANS.filter(([k]) => k !== "ultimate").map(([key, name, tag, features]) => (
                <article className="rounded-3xl border border-line bg-card p-5 shadow-card transition md:hover:border-forest/30" key={key}>
                  <h2 className="font-display text-2xl font-semibold text-forest">{name}</h2>
                  <p className="mt-2 text-sm text-stone">{tag}</p>
                  <p className="mt-4 font-display text-3xl font-semibold text-forest">
                    {key === "free" ? <>$0<span className="font-sans text-sm font-normal text-stone">/forever</span></> : <>{money(price(key))}<span className="font-sans text-sm font-normal text-stone">/{isAnnual ? "yr" : "mo"}</span></>}
                  </p>
                  {key !== "free" && isAnnual && <p className="mt-1 text-sm font-semibold text-forest">Save {key === "steady" ? "$9.98" : "$24.98"}</p>}
                  {key !== "free" && checkinActive && !isAnnual && <p className="mt-1 text-sm font-semibold text-forest">First 3 months: {key === "steady" ? "$2.49" : "$6.24"}/mo — 50% off</p>}
                  <details className="mt-4 group"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-forest [&::-webkit-details-marker]:hidden">All benefits <IconChevronDown className="h-5 w-5 text-forest-soft transition-transform duration-200 group-open:rotate-180" /></summary><ul className="mt-2 space-y-2 text-sm text-stone">{features.map((x) => <li key={x} className="flex items-start gap-2"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" /><span>{x}</span></li>)}</ul></details>
                  {key === "free" ? (
                    <a href="/#review" className="btn-ghost mt-6 block w-full text-center">Start free</a>
                  ) : (
                    <button onClick={() => checkout(key, isAnnual ? "year" : "month")} className="btn-ghost mt-6 w-full">
                      {busy === `${key}${isAnnual ? "year" : "month"}` ? "Opening checkout…" : key === "command" ? "Get Command Center" : `Choose ${name}`}
                    </button>
                  )}
                  {key === "command" && <p className="mt-2 text-sm text-stone">Document Organizer, Case Summary, Action Center, and Export — all live.</p>}
                </article>
              ))}
            </div>

            {/* Ultimate hero card — Recommended, keeps its full-width treatment */}
            <div className="mt-6 rounded-[2rem] border-2 border-forest bg-card p-6 shadow-card sm:p-8">
              <span className="rounded-full bg-forest px-4 py-1 text-sm font-semibold text-cream">Recommended — the complete system</span>
              <h2 className="mt-4 font-display text-3xl font-semibold text-forest">Ultimate Co-Parent</h2>
              <p className="mt-2 text-stone">Everything we offer, one plan — plus a human to talk it through.</p>
              <p className="mt-5 font-display text-4xl font-semibold text-forest">
                {money(price("ultimate"))}<span className="font-sans text-base font-normal text-stone"> / {isAnnual ? "year" : "month"}</span>
              </p>
              {isAnnual && <p className="mt-2 font-semibold text-forest">Save $49.98/year vs monthly</p>}
              {checkinActive && !isAnnual && <p className="mt-2 font-semibold text-forest">First 3 months: $12.49/mo — 50% off</p>}
              <p className="mt-3 text-sm text-stone">
                $127.49 of included items at list prices — $12.50/mo more than Command Center
              </p>
              <details className="mt-5 group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-forest [&::-webkit-details-marker]:hidden">All benefits <IconChevronDown className="h-5 w-5 text-forest-soft transition-transform duration-200 group-open:rotate-180" /></summary>
                <ul className="mt-3 grid gap-2 text-stone sm:grid-cols-2">{PLANS[3][3].map((x) => <li key={x} className="flex items-start gap-2"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" /><span>{x}</span></li>)}</ul>
              </details>
              <button onClick={() => checkout("ultimate", isAnnual ? "year" : "month")} className="btn-primary mt-7 w-full">
                {busy === "ultimatemonth" || busy === "ultimateyear" ? "Opening checkout…" : "Get Ultimate Co-Parent"}
              </button>
              <p className="mt-3 text-sm text-stone">Cancel anytime · First 3 months at $19.99 · 2 months free on annual</p>
            </div>

            {/* Launch-offer in-flow card (reward-loop spec Step 7.3): replaces the
                auto-modal on pricing. Non-blocking, no timer, at the BOTTOM of the
                plan cards — and only after the visitor has gotten value (a completed
                review or Check-In) this session. Never before value. */}
            {valueDelivered() && !checkinActive && !isUltimate && !offerAccepted() && !purchasedThisSession() && (
              <div className="mt-6 rounded-3xl border border-forest/25 bg-cream-deep/70 p-6 text-center">
                <p className="text-base font-semibold text-forest">Still deciding? Here's the whole system at the launch price.</p>
                <p className="mt-2 text-base leading-relaxed text-stone">Ultimate Co-Parent — everything included — $19.99/mo for your first 3 months, then $24.99. Cancel anytime.</p>
                <button onClick={() => checkout("ultimate", "month")} className="btn-primary mt-4">
                  {busy === "ultimatemonth" ? "Opening checkout…" : "Get Ultimate — $19.99/mo × 3"}
                </button>
              </div>
            )}
          </>
        )}

        {tab === "One-time" && (
          <section className="mt-7">
            <div className="grid gap-4 sm:grid-cols-2">
              {ONETIME.map(([n, p, d, included]) => (
                <article className="rounded-3xl border border-line bg-card p-5 shadow-card transition md:hover:border-forest/30" key={n}>
                  <h2 className="font-display text-2xl font-semibold text-forest">{n}</h2>
                  <p className="mt-2 font-display text-3xl text-forest">{p}</p>
                  <p className="mt-2 text-stone">{d}</p>
                  <p className="mt-3 text-sm text-stone">Buy once — no subscription{n === "Review Top-Up" ? " · 10 credits" : ""}</p>
                  {n === "Record Review" ? (
                    recordReview?.entitled && recordReview.kind === "purchased" ? (
                      <span className="mt-4 inline-block rounded-full border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Record Review unlocked ✓</span>
                    ) : recordReview?.entitled ? (
                      // kind === "ultimate" — allowance available this year.
                      <span className="mt-4 inline-block rounded-full border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Already included in Ultimate ✓</span>
                    ) : (
                      // Not entitled — Ultimate members who used their 1/year
                      // allowance see the Buy button too (honest: they can buy more).
                      <button onClick={() => checkout("record_review")} className="btn-ghost mt-4 w-full">Buy Record Review</button>
                    )
                  ) : isUltimate && included ? (
                    <span className="mt-4 inline-block rounded-full border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Already included in Ultimate ✓</span>
                  ) : n === "Attorney Prep Pack" && attorneyPrepOwned ? (
                    <span className="mt-4 inline-block rounded-full border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Attorney Prep Pack unlocked ✓</span>
                  ) : n === "Sort My Pile" ? (
                    <button onClick={() => checkout("sortpile")} className="btn-ghost mt-4 w-full">Buy Sort My Pile</button>
                  ) : n === "Review Top-Up" ? (
                    <button onClick={() => checkout("topup")} className="btn-ghost mt-4 w-full">Buy Review Top-Up</button>
                  ) : n === "Gift a month of Steady" ? (
                    <button onClick={() => checkout("gift")} className="btn-ghost mt-4 w-full">Buy Gift a Month</button>
                  ) : n === "Attorney Prep Pack" ? (
                    <button onClick={() => checkout("attorney_prep_pack")} className="btn-ghost mt-4 w-full">Buy Attorney Prep Pack</button>
                  ) : (
                    <button onClick={() => checkout("consultation")} className="btn-ghost mt-4 w-full">Buy One Conversation</button>
                  )}
                </article>
              ))}
            </div>
            <p className="mt-3 text-sm text-stone">One-time, no subscription — or already included in Ultimate Co-Parent.</p>
          </section>
        )}

        {tab === "Compare" && (
          <>
            {/* Mobile card layout — one card per feature row. No table at
                <md (audit TOP-10 #1 CRITICAL — the 4-col table is unreadable
                at 390px; sticky-column bleed is sidestepped entirely). */}
            <div className="mt-7 space-y-4 md:hidden">
              {COMPARE_ROWS.map((r) => (
                <div key={r[0]} className="rounded-3xl border border-line bg-card p-5 shadow-card">
                  <p className="font-semibold text-forest">{r[0]}</p>
                  <div className="mt-3 space-y-2">
                    {["Free", "Steady", "Command", "Ultimate"].map((p, i) => (
                      <div key={p} className="flex items-center justify-between gap-3">
                        <span className={`text-sm ${i === 3 ? "font-semibold text-forest" : "text-stone"}`}>{p}</span>
                        <span className={`text-sm ${i === 3 ? "font-semibold text-forest" : "text-ink"}`}>{r[i + 1]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table — ≥md only, min-w [640px] so it fits without
                horizontal scroll at md; sticky first column keeps its bg. */}
            <div className="mt-7 hidden overflow-x-auto md:block">
              <table className="min-w-[640px] w-full text-left text-sm">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-cream p-3">Feature</th>
                    {["Free", "Steady", "Command", "Ultimate"].map((x, i) => (
                      <th key={x} className={`p-3 text-forest ${i === 3 ? "bg-forest/10" : ""}`}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((r) => (
                    <tr className="border-t border-line" key={r[0]}>
                      {r.map((c, i) => (
                        <td key={`${r[0]}-${i}`} className={`p-3 ${i === 0 ? "sticky left-0 bg-cream font-semibold" : ""} ${i === 4 ? "bg-forest/5 font-semibold text-forest" : ""}`}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "FAQ" && (
          <section className="mt-7 space-y-5 text-stone">
            <p><b>Is this legal advice?</b><br />No. Communication guidance and organization, not legal advice.</p>
            <p><b>Can I cancel?</b><br />Yes — cancel anytime from the account's Manage subscription button (it opens Stripe's billing portal) — no phone call needed. Access continues through the paid period.</p>
            <p><b>What is the special offer?</b><br />Ultimate is $19.99/mo for the first 3 months, then $24.99/mo. There is no countdown or fake deadline.</p>
            <p><b>Do one-time buys need a subscription?</b><br />No. They are separate purchases.</p>
            <p><b>If I'm on Ultimate, do I pay for one-time items?</b><br />No — included items are included in Ultimate Co-Parent.</p>
            <p><b>What happens to my data?</b><br />Your drafts and records stay private. We never sell your data.</p>
          </section>
        )}

        {msg && <p role="status" className="mt-5 rounded-xl bg-cream-deep p-4">{msg}</p>}
        {purchased && (
          <a href="/home" className="btn-primary mt-5 block w-full text-center sm:w-auto">
            Open your Command Center →
          </a>
        )}
        {giftCode && (
          <div className="mt-5 rounded-3xl border border-forest/25 bg-card p-6 shadow-card">
            <p className="text-lg font-semibold text-forest">Your gift is ready.</p>
            <p className="mt-1 text-base text-stone">One month of Steady, for a dad who needs it.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="rounded-2xl border border-line bg-cream-deep px-4 py-3 font-mono text-lg font-semibold tracking-wider text-forest">{giftCode}</span>
              <button onClick={copyGiftCode} className="btn-ghost min-h-11 text-forest">Copy</button>
            </div>
            <p className="mt-3 text-base text-stone">Send it to a dad who needs it — they sign in, enter the code, done.</p>
            <button onClick={shareGiftLink} className="mt-3 min-h-11 text-base font-semibold text-forest underline underline-offset-4">Share a link →</button>
            <p className="mt-2 text-sm text-stone">Codes are valid for 90 days.</p>
            {giftCopied && <p role="status" className="mt-3 text-base text-stone">Copied.</p>}
          </div>
        )}
        {needLogin && (
          <a href={needLoginHref} className="btn-primary mt-5 block w-full text-center sm:w-auto">
            Sign in to link your purchase →
          </a>
        )}
        <section className="mt-12 rounded-3xl border border-line bg-card p-6 text-stone">
          <b>No pressure. No lock-in.</b><br />
          The free review always stays free. Your drafts and records are private.
        </section>
      </main>
      <SiteFooter />
      {tab === "Memberships" && !purchased && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream/95 px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
          <button onClick={() => checkout("ultimate", isAnnual ? "year" : "month")} className="btn-primary min-h-12 w-full text-base">
            {busy === `ultimate${isAnnual ? "year" : "month"}` ? "Opening checkout…" : checkinActive && !isAnnual ? "Get Ultimate Co-Parent · $12.49/mo × 3" : `Get Ultimate Co-Parent · ${money(price("ultimate"))}/${isAnnual ? "yr" : "mo"}`}
          </button>
        </div>
      )}
    </div>
  );
}
