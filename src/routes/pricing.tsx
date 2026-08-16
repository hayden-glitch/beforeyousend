import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { isCleanQueryParam, track, trackFunnelOnce } from "~/lib/analytics";
import { recordSurface, markPurchasedThisSession, offerAccepted, purchasedThisSession, valueDelivered } from "~/lib/offer";
import { IconCheck, IconChevronDown } from "~/components/icons";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import { consultationMoney } from "~/lib/prices";
import { scrollBehavior } from "~/lib/motion";
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute("/pricing")({
  head: () => ({
    ...seoHead({
      title: "Pricing — Before You Send",
      description: "Steady, Command Center, and Ultimate plans — starting with a review that's always free. No pressure, cancel anytime.",
      path: "/pricing",
    }),
  }),
  component: Pricing,
});
type PlanKey = "steady" | "command" | "ultimate";
type Interval = "month" | "year";
type DeepTab = "One-time" | "Compare" | "FAQ" | null;
const monthly = { steady: 499, command: 1249, ultimate: 2499 };
const annual = { steady: 4990, command: 12490, ultimate: 24990 };
const money = (n: number) => "$" + (n / 100).toFixed(2).replace(/\.00$/, "");
// D3 (spec §12 / DECISION.md §12): 3 paid levels + free reference. Each card
// shows the JOB under the name, 4 distinguishing benefits visibly, and any
// extras behind a quiet disclosure. Command Center is the ONE recommended
// plan (broad product value — reviews + organized record + tools). Free is
// de-emphasized as a reference line below the cards, not a fourth card.
const PLAN_ORDER: PlanKey[] = ["steady", "command", "ultimate"];
const PLAN_META: Record<PlanKey, { name: string; job: string; perks: string[]; more?: string[] }> = {
  steady: {
    name: "Steady",
    job: "Ongoing communication reviews, every time you need one.",
    perks: ["30 message reviews a month", "Unlimited saved history", "Unlimited Log & Timeline", "Real-person email support"],
  },
  command: {
    name: "Command Center",
    job: "Reviews, plus your whole record — organized and ready.",
    perks: ["Unlimited message reviews", "Document Organizer with smart tagging", "Case Summary built from your record", "Action Center + Export pack"],
  },
  ultimate: {
    name: "Ultimate Co-Parent",
    job: "Everything, with a consultation and packs included.",
    perks: ["Everything in Command Center", `1 free consultation a year (${consultationMoney} value)`, "All one-time packs included", "Priority support + scheduling"],
    more: ["Kickstart onboarding + early access"],
  },
};
const TIER_NAMES: Record<string, string> = { steady: "Steady", command: "Command Center", ultimate: "Ultimate Co-Parent" };
// [name, price, delivery line, includedInUltimate] — LIVE one-time products.
// §21 pass: no folder language, no repeated "calm" (the record speaks for
// itself). The checkout wiring below is untouched (§27 gate 9).
const ONETIME: [string, string, string, boolean][] = [
  ["One Conversation", consultationMoney, "45 minutes focused on your situation.", false],
  ["Review Top-Up", "$9.50", "10 review credits; no expiry, stackable.", true],
  ["Gift a Month", "$4.99", "One month of Steady for another dad, delivered as a code you can share.", true],
  ["Sort My Pile", "$19.50", "Up to 50 documents filed into your Organizer for you — with 30 days of the live Organizer included.", true],
  ["Attorney Prep Pack", "$24.50", "Your record, prepared for your attorney — cover sheet, chronology, evidence index, and more. Generated from your record.", true],
  ["Record Review", "$29.50", "A thorough read of your whole record — patterns, evidence strengths, and what to document next. Not legal advice.", true],
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
// Mobile decision aid (blocker #3): answers "Which plan fits me?" BEFORE the
// exhaustive inventory. One honest line per plan — no invented stats.
const FIT_GUIDE: [PlanKey, string][] = [
  ["steady", "Ongoing reviews and a full history — without the record tools."],
  ["command", "Reviews plus your whole record — organized and ready."],
  ["ultimate", "Everything in Command Center, plus a consultation and all one-time packs."],
];
// Safe demo data (spec §14 — tangible product sample instead of more bullets):
// what a Command Center record looks like. Same shape as the landing chain.
const LEDGER_SAMPLE: { date: string; title: string; kind: string }[] = [
  { date: "Aug 12", title: "Draft review — calm version sent", kind: "Review" },
  { date: "Aug 10", title: "Pick-up change", kind: "Log" },
  { date: "Aug 04", title: "Parenting plan", kind: "Document" },
];
function Pricing() {
  // ?tab= deep link (Tools cards send ?tab=One-time so an upsell lands on the
  // right pricing section; the attorney-prep-pack branch uses the same param).
  // The 4 top tabs are GONE (§12) — the deep link now scrolls to the section
  // on the single page. tab is a SAFE_UI_VALUE so it survives the scrub.
  const [deepTab, setDeepTab] = useState<DeepTab>(null);
  // Blocker #3: the mobile "One-time tools" disclosure — auto-opens when a
  // tools-card deep link (?tab=One-time) lands on the section.
  const [onetimeOpen, setOnetimeOpen] = useState(false);
  const [selected, setSelected] = useState<PlanKey | null>(null); // §12: sticky CTA stays neutral until a meaningful selection
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
  // Where the sign-in link should return the user. Built from the captured
  // Stripe-return URL so checkout=success&plan=...&session_id=... survives the
  // login round-trip and the mount effect below re-fires /api/checkout/confirm
  // automatically. Default stays /pricing for ordinary login-required CTAs.
  const [needLoginHref, setNeedLoginHref] = useState("/login?next=/pricing");
  // P0 hotfix (work order 5300912458): capture the Stripe-return payload and
  // the full return continuation ONCE, at first render — BEFORE the mount
  // effect scrubs checkout/session_id/plan out of the visible URL. The async
  // confirm + 401 handlers below MUST use these captured values, never
  // window.location.search after the replaceState (previously the scrub ran
  // synchronously before the confirm response resolved, so a logged-out
  // checkout return built its login href from the ALREADY-CLEANED URL and the
  // session_id was lost — the purchase could never be linked on the round-trip).
  const returnRef = useRef<{
    sessionId: string | null;
    plan: string;
    checkout: string | null;
    tab: string | null;
    checkin: string | null;
    continuation: string;
  } | null>(null);
  if (returnRef.current === null && typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    returnRef.current = {
      sessionId: q.get("session_id"),
      plan: q.get("plan") || "",
      checkout: q.get("checkout"),
      tab: q.get("tab"),
      checkin: q.get("checkin"),
      continuation: window.location.pathname + window.location.search,
    };
  }

  useEffect(() => {
    track("pricing_viewed", {});
    // P0 hotfix (work order 5300912458): scrub checkout/session_id/plan out of
    // the visible URL IMMEDIATELY (synchronously, before the confirm round-trip
    // and before the root analytics effect initializes measurement) so the
    // payment identifier never lingers in the address bar or any later
    // analytics capture. Only exact known UI values (tab/checkin) and
    // ad-attribution params survive — everything else non-attribution is
    // dropped. The captured returnRef (first render, pre-scrub) is the single
    // source of truth for the confirm payload and the login continuation.
    const scrubReturnUrl = () => {
      try {
        const clean = new URLSearchParams();
        const qq = new URLSearchParams(window.location.search);
        for (const [k, v] of qq) { if (isCleanQueryParam(k, v)) clean.set(k, v); }
        const s = clean.toString();
        window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
      } catch { /* noop */ }
    };
    scrubReturnUrl();
    const snap = returnRef.current;
    setCheckinActive(snap?.checkin === "50");
    if (snap?.tab === "One-time" || snap?.tab === "Compare" || snap?.tab === "FAQ") {
      setDeepTab(snap.tab as DeepTab);
      if (snap.tab === "One-time") setOnetimeOpen(true);
    }
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((j) => { setIsUltimate(j.user?.profile?.tier === "ultimate"); setMyTier(j.quota?.tier || j.user?.profile?.tier || "free"); setAttorneyPrepOwned(!!j.entitlements?.attorneyPrep); setRecordReview(j.entitlements?.recordReview || { entitled: false, kind: "none" }); })
      .catch(() => {});
    if (snap?.checkout === "success" && snap.sessionId) {
      // Checkout return — record the purchase (suppresses the offer this session).
      markPurchasedThisSession();
      const plan = snap.plan;
      fetch("/api/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: snap.sessionId }),
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
              // P0 hotfix: the continuation is the CAPTURED pre-scrub URL —
              // window.location.search is already clean by the time the 401
              // resolves and would drop session_id.
              setNeedLogin(true);
              setNeedLoginHref(`/login?next=${encodeURIComponent(snap.continuation)}`);
              setMsg("Your purchase went through — sign in to link it to your account.");
            } else {
              setMsg(j.error || "We couldn't confirm your purchase yet — it may take a minute.");
            }
          }
        })
        .catch(() => setMsg("We couldn't confirm your purchase yet — it may take a minute."));
    } else if (snap?.checkout === "cancelled") {
      recordSurface("checkout_return");
      setMsg("No problem — nothing was charged. Come back whenever you're ready.");
    } else {
      recordSurface("pricing");
    }
  }, []);

  // §12 deep-link landing: ?tab=One-time / Compare / FAQ scroll to the section
  // on the single page (no more tab modes). Scroll after the first paint so
  // layout is settled; reduced-motion uses the site-wide instant scroll.
  useEffect(() => {
    if (!deepTab) return;
    const id = deepTab === "One-time" ? "one-time" : deepTab === "Compare" ? "compare" : "pricing-faq";
    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [deepTab]);

  async function checkout(plan: PlanKey | "topup" | "consultation" | "gift" | "sortpile" | "attorney_prep_pack" | "record_review", interval: Interval = "month") {
    setBusy(`${plan}${interval}`);
    setMsg("");
    // Round-6 funnel: plan/interval identifiers only — no sensitive data.
    trackFunnelOnce("funnel_started", { entry: "pricing" });
    track("funnel_option_selected", { plan, interval });
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
      else if (r.status === 401 || d.login_required) {
        // Track B item 2: visible login handling on every public caller, with
        // the purchase intent preserved in ?next= (and the URL kept intact so a
        // checkout=success return re-fires confirm). No sensitive answers ride
        // the URL — the check-in answers never leave the device.
        setNeedLogin(true);
        setNeedLoginHref(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        setMsg("Sign in to start checkout — your purchase is linked to your account.");
      }
      else setMsg(d.error || "Checkout is not available right now.");
    } catch {
      setMsg("Checkout is not available right now.");
    }
    setBusy("");
  }

  const price = (p: PlanKey) => (isAnnual ? annual[p] : monthly[p]);

  function selectPlan(key: PlanKey) {
    setSelected((prev) => (prev === key ? null : key));
    // Round-6 funnel vocabulary only (no new analytics events — §24/§27):
    // a card selection is an option pick, plan/interval identifiers only.
    if (selected !== key) track("funnel_option_selected", { plan: key, interval: isAnnual ? "year" : "month" });
  }
  function scrollToPlans() {
    document.getElementById("plans")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  }

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

  const planName = (k: PlanKey) => PLAN_META[k].name;
  const stickyLabel = selected ? `Get ${planName(selected)} · ${money(price(selected))}/${isAnnual ? "yr" : "mo"}` : "Choose a plan";

  // One-time action renderer — shared by the mobile disclosure rows and the
  // desktop card grid so the entitlement/guard logic (Record Review allowance,
  // Ultimate inclusion, Attorney Prep ownership) stays EXACTLY as before.
  function oneTimeAction(n: string, included: boolean) {
    if (n === "Record Review") {
      if (recordReview?.entitled && recordReview.kind === "purchased") {
        return <span className="mt-4 inline-block w-fit rounded-[10px] border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Record Review unlocked ✓</span>;
      }
      if (recordReview?.entitled) {
        return <span className="mt-4 inline-block w-fit rounded-[10px] border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Already included in Ultimate ✓</span>;
      }
      return <button onClick={() => checkout("record_review")} className="btn-ghost mt-4 w-full">Buy Record Review</button>;
    }
    if (isUltimate && included) {
      return <span className="mt-4 inline-block w-fit rounded-[10px] border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Already included in Ultimate ✓</span>;
    }
    if (n === "Attorney Prep Pack" && attorneyPrepOwned) {
      return <span className="mt-4 inline-block w-fit rounded-[10px] border border-forest/25 bg-forest px-4 py-2 text-sm font-semibold text-cream">Attorney Prep Pack unlocked ✓</span>;
    }
    if (n === "Sort My Pile") return <button onClick={() => checkout("sortpile")} className="btn-ghost mt-4 w-full">Buy Sort My Pile</button>;
    if (n === "Review Top-Up") return <button onClick={() => checkout("topup")} className="btn-ghost mt-4 w-full">Buy Review Top-Up</button>;
    if (n === "Gift a Month") return <button onClick={() => checkout("gift")} className="btn-ghost mt-4 w-full">Buy Gift a Month</button>;
    if (n === "Attorney Prep Pack") return <button onClick={() => checkout("attorney_prep_pack")} className="btn-ghost mt-4 w-full">Buy Attorney Prep Pack</button>;
    return <button onClick={() => checkout("consultation")} className="btn-ghost mt-4 w-full">Buy One Conversation</button>;
  }

  return (
    <div className="min-h-dvh">
      <SiteHeader active="pricing" />
      <main className="mx-auto max-w-6xl px-5 pb-40 pt-12">
        {/* One-line headline explains the choice (§12). No tabs, no modes. */}
        <h1 className="text-[clamp(1.9rem,5vw,2.6rem)] font-bold leading-[1.08] tracking-tight text-ink">
          Choose how much of the system you need.
        </h1>
        <p className="mt-3 max-w-xl text-lg leading-relaxed text-stone">
          Start with a free review — no account needed. Upgrade when the record matters.
        </p>

        {/* Quiet monthly/annual toggle — text buttons, no filled pill (§12). */}
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="inline-flex items-center gap-5 border-b border-line">
            <button
              aria-pressed={!isAnnual}
              onClick={() => setAnnual(false)}
              className={`-mb-px min-h-11 border-b-2 px-1 text-base font-semibold transition-colors duration-150 ${
                !isAnnual ? "border-forest text-ink" : "border-transparent text-stone hover:text-ink"
              }`}
            >
              Monthly
            </button>
            <button
              aria-pressed={isAnnual}
              onClick={() => setAnnual(true)}
              className={`-mb-px min-h-11 border-b-2 px-1 text-base font-semibold transition-colors duration-150 ${
                isAnnual ? "border-forest text-ink" : "border-transparent text-stone hover:text-ink"
              }`}
            >
              Annual
            </button>
          </div>
          {isAnnual && <span className="text-sm font-medium text-forest">2 months free — 10 months for the price of 12</span>}
        </div>

        {/* Co-Parent Check-In offer banner — arrived via ?checkin=50.
            First 3 months at half price on monthly plans. Honest, no countdown. */}
        {checkinActive && (
          <div className="mt-6 rounded-xl border border-forest/25 bg-cream-deep/70 px-5 py-3.5 text-base text-forest">
            You have the Check-In offer — your first 3 months at half price on monthly plans.
          </div>
        )}

        {/* Three paid levels — Command Center is the ONE recommended plan
            (broad value: reviews + organized record + tools). Cards are
            selectable; the mobile sticky bar reflects the selection (§12). */}
        <section id="plans" aria-label="Membership plans" className="mt-8">
          <div className="grid gap-4 lg:grid-cols-3">
            {PLAN_ORDER.map((key) => {
              const meta = PLAN_META[key];
              const rec = key === "command";
              const isSel = selected === key;
              return (
                <article
                  key={key}
                  role="radio"
                  aria-checked={isSel}
                  aria-label={`${meta.name} plan`}
                  tabIndex={0}
                  onClick={() => selectPlan(key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPlan(key); }
                  }}
                  className={`card relative flex cursor-pointer flex-col p-6 outline-none transition-colors duration-150 ${
                    rec ? "border-forest/45" : "border-line"
                  } ${isSel ? "border-forest" : ""} hover:border-forest/30`}
                >
                  {rec && (
                    <span className="absolute -top-3 left-5 inline-flex min-h-6 items-center rounded-full border border-forest/40 bg-elevated px-3 text-xs font-semibold tracking-wide text-forest">
                      Recommended
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-xl font-semibold text-ink">{meta.name}</h2>
                    {isSel && <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-forest text-cream"><IconCheck className="h-4 w-4" /></span>}
                  </div>
                  <p className="mt-1.5 text-sm leading-relaxed text-stone">{meta.job}</p>
                  <p className="mt-4 text-3xl font-semibold tabular-nums text-ink">
                    {money(price(key))}<span className="text-sm font-normal text-stone">/{isAnnual ? "yr" : "mo"}</span>
                  </p>
                  <p className="mt-1 text-sm text-stone">
                    {isAnnual ? `10 months · save ${key === "steady" ? "$9.98" : key === "command" ? "$24.98" : "$49.98"}` : `or ${money(annual[key])} a year`}
                  </p>
                  {key === "ultimate" && !checkinActive && !isAnnual && (
                    <p className="mt-1 text-sm font-medium text-forest">First 3 months at $19.99 — then $24.99/mo</p>
                  )}
                  {key !== "steady" && checkinActive && !isAnnual && key !== "command" && (
                    <p className="mt-1 text-sm font-medium text-forest">First 3 months: $12.49/mo — 50% off</p>
                  )}
                  {key === "command" && checkinActive && !isAnnual && (
                    <p className="mt-1 text-sm font-medium text-forest">First 3 months: $6.24/mo — 50% off</p>
                  )}
                  {key === "steady" && checkinActive && !isAnnual && (
                    <p className="mt-1 text-sm font-medium text-forest">First 3 months: $2.49/mo — 50% off</p>
                  )}

                  {/* Tangible product sample for the recommended card (§14):
                      a real Command Center record shape, not another bullet. */}
                  {rec && (
                    <div className="mt-4 rounded-[10px] border border-line bg-cream-deep/60 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[.08em] text-taupe">Your record, in one place</p>
                      <div className="mt-1.5 space-y-1.5">
                        {LEDGER_SAMPLE.map((r) => (
                          <div key={r.title} className="ledger-row !pt-1.5">
                            <span className="d">{r.date}</span>
                            <span className="t">{r.title}</span>
                            <span className="k2">{r.kind}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <ul className="mt-4 space-y-2 text-sm leading-relaxed text-stone">
                    {meta.perks.map((x) => (
                      <li key={x} className="flex items-start gap-2"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" /><span>{x}</span></li>
                    ))}
                  </ul>
                  {meta.more && meta.more.length > 0 && (
                    <details className="mt-2 group">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-forest [&::-webkit-details-marker]:hidden">
                        All benefits <IconChevronDown className="h-4 w-4 text-stone transition-transform duration-200 group-open:rotate-180" />
                      </summary>
                      <ul className="mt-1 space-y-2 text-sm leading-relaxed text-stone">
                        {meta.more.map((x) => (
                          <li key={x} className="flex items-start gap-2"><IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" /><span>{x}</span></li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <div className="mt-auto pt-5">
                    <button
                      onClick={(e) => { e.stopPropagation(); checkout(key, isAnnual ? "year" : "month"); }}
                      className={`w-full ${rec ? "btn-primary" : "btn-ghost"}`}
                    >
                      {busy === `${key}${isAnnual ? "year" : "month"}` ? "Opening checkout…" : `Start ${meta.name}`}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Free — a quiet reference line, not a competing fourth card (§12). */}
          <p className="mt-6 text-center text-sm leading-relaxed text-stone">
            Just starting? <span className="font-semibold text-ink">Free</span> — first review always free, no account, 5 reviews a month with an account.{" "}
            <a href="/#review" className="font-semibold text-forest underline underline-offset-4">Try the free review</a>
          </p>

          {/* Renewal + cancel mechanics stated plainly (§9/§12); privacy and
              not-legal-advice links stay in the decision context. */}
          <p className="mt-3 text-center text-xs leading-relaxed text-taupe">
            Monthly or annual plans renew automatically until you cancel. Cancel anytime from your account — access continues through the paid period.{" "}
            <a href="/trust" className="underline underline-offset-2 hover:text-ink">How privacy works</a> · Not legal advice.
          </p>
        </section>

        {/* Launch-offer in-flow card (reward-loop spec Step 7.3): replaces the
            auto-modal on pricing. Non-blocking, no timer, at the BOTTOM of the
            plan cards — and only after the visitor has gotten value (a completed
            review or Check-In) this session. Never before value. */}
        {valueDelivered() && !checkinActive && !isUltimate && !offerAccepted() && !purchasedThisSession() && (
          <div className="card mt-6 border-forest/25 p-6 text-center">
            <p className="text-base font-semibold text-ink">Still deciding? Ultimate at the launch price — $19.99/mo × 3.</p>
            <p className="mt-1.5 text-base leading-relaxed text-stone">Everything included, then $24.99/mo. Cancel anytime.</p>
            <button onClick={() => checkout("ultimate", "month")} className="btn-primary mt-4">
              {busy === "ultimatemonth" ? "Opening checkout…" : "Get Ultimate — $19.99/mo × 3"}
            </button>
          </div>
        )}

        {/* Comparison — a concise section farther down, not a top-level tab
            (§12). Mobile (blocker #3): decision-first — a "Which plan fits
            me?" guide, then the full list behind ONE collapsible surface with
            per-feature accordion rows. NO repeated full-width cards. Desktop
            keeps the unchanged comparison table. */}
        <section id="compare" aria-label="Compare plans" className="mt-14">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Compare everything</h2>
          <p className="mt-1.5 max-w-xl text-base leading-relaxed text-stone">The full list, in one place.</p>
          {/* Mobile — compact progressive disclosure (<md). */}
          <div className="mt-5 md:hidden">
            <div className="card p-5">
              <p className="font-semibold text-ink">Which plan fits me?</p>
              <div className="mt-3 space-y-2">
                {FIT_GUIDE.map(([k, line]) => (
                  <div key={k} className="rounded-[10px] border border-line bg-cream-deep/50 px-3.5 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">{PLAN_META[k].name}</p>
                      <p className="text-sm font-semibold tabular-nums text-forest">
                        {money(price(k))}<span className="text-xs font-normal text-stone">/{isAnnual ? "yr" : "mo"}</span>
                      </p>
                    </div>
                    <p className="mt-0.5 text-sm leading-snug text-stone">{line}</p>
                  </div>
                ))}
              </div>
            </div>
            <details className="group mt-4 overflow-hidden rounded-[14px] border border-line bg-card shadow-card">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <span className="text-sm font-semibold text-ink">Compare plans — full list</span>
                <span className="flex items-center gap-1.5 text-sm text-stone">
                  {COMPARE_ROWS.length} features
                  <IconChevronDown className="h-4 w-4 text-stone transition-transform duration-200 group-open:rotate-180" />
                </span>
              </summary>
              <div className="divide-y divide-line border-t border-line">
                {COMPARE_ROWS.map((r) => {
                  const headline = r[3] !== "—" ? r[3] : r[4] !== "—" ? r[4] : r[2];
                  return (
                    <details key={r[0]} className="group/row">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                        <span className="text-sm font-medium text-ink">{r[0]}</span>
                        <span className="flex items-center gap-2 text-sm">
                          <span className={r[3] !== "—" ? "font-semibold text-forest" : "text-stone"}>{headline}</span>
                          <IconChevronDown className="h-3.5 w-3.5 shrink-0 text-stone transition-transform duration-200 group-open/row:rotate-180" />
                        </span>
                      </summary>
                      <div className="px-4 pb-3 pt-1">
                        {(["Free", "Steady", "Command", "Ultimate"] as const).map((p, i) => (
                          <div key={p} className="flex items-center justify-between gap-3 py-1 text-sm">
                            <span className={i === 2 ? "font-semibold text-forest" : "text-stone"}>{p}</span>
                            <span className={i === 2 ? "font-semibold text-forest" : "text-ink"}>{r[i + 1]}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </details>
          </div>
          {/* Desktop table — ≥md only, min-w [640px] so it fits without
              horizontal scroll at md; sticky first column keeps its bg. */}
          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-[640px] w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-cream p-3">Feature</th>
                  {["Free", "Steady", "Command", "Ultimate"].map((x, i) => (
                    <th key={x} className={`p-3 text-forest ${i === 2 ? "bg-forest/10" : ""}`}>{x}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((r) => (
                  <tr className="border-t border-line" key={r[0]}>
                    {r.map((c, i) => (
                      <td key={`${r[0]}-${i}`} className={`p-3 ${i === 0 ? "sticky left-0 bg-cream font-semibold" : ""} ${i === 2 ? "bg-forest/5 font-semibold text-forest" : ""}`}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* One-time packs — BELOW the membership decision AND the comparison.
            On mobile they sit behind a compact "One-time tools" disclosure
            (auto-opens for ?tab=One-time deep links from the tools cards), so
            they never compete with — or card-farm below — the plan choice. */}
        <section id="one-time" aria-label="One-time packs" className="mt-14">
          <h2 className="text-2xl font-bold tracking-tight text-ink">One-time packs</h2>
          <p className="mt-1.5 max-w-xl text-base leading-relaxed text-stone">Buy once, no subscription. Useful when a plan is more than you need right now.</p>
          {/* Mobile — one disclosure, compact rows, dimmer than the plan cards. */}
          <details
            className="group mt-5 overflow-hidden rounded-[14px] border border-line bg-card shadow-card md:hidden"
            open={onetimeOpen}
            onToggle={(e) => setOnetimeOpen(e.currentTarget.open)}
          >
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="text-sm font-semibold text-ink">One-time tools</span>
              <span className="flex items-center gap-1.5 text-sm text-stone">
                {ONETIME.length} items
                <IconChevronDown className="h-4 w-4 text-stone transition-transform duration-200 group-open:rotate-180" />
              </span>
            </summary>
            <div className="divide-y divide-line border-t border-line">
              {ONETIME.map(([n, p, d, included]) => (
                <div key={n} className="px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-base font-semibold text-ink">{n}</h3>
                    <p className="text-lg font-semibold tabular-nums text-ink">{p}</p>
                  </div>
                  <p className="mt-0.5 text-sm leading-relaxed text-stone">{d}</p>
                  {oneTimeAction(n, included)}
                </div>
              ))}
            </div>
          </details>
          {/* Desktop — the unchanged card grid (≥md only). */}
          <div className="mt-5 hidden gap-4 sm:grid-cols-2 md:grid">
            {ONETIME.map(([n, p, d, included]) => (
              <article key={n} className="card flex flex-col p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-lg font-semibold text-ink">{n}</h3>
                  <p className="text-2xl font-semibold tabular-nums text-ink">{p}</p>
                </div>
                <p className="mt-2 flex-1 text-base leading-relaxed text-stone">{d}</p>
                {oneTimeAction(n, included)}
              </article>
            ))}
          </div>
          <p className="mt-3 text-sm text-stone">One-time, no subscription — or already included in Ultimate Co-Parent.</p>
        </section>

        {/* FAQ below the decision, not a mode (§12). */}
        <section id="pricing-faq" aria-label="Pricing questions" className="mt-14 max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-ink">Questions</h2>
          <div className="mt-3 divide-y divide-line">
            {[
              ["Is this legal advice?", "No. Communication guidance and organization, not legal advice."],
              ["Can I cancel?", "Yes — from the account's Manage subscription button (Stripe's billing portal). Access continues through the paid period."],
              ["Does the plan renew automatically?", "Yes — monthly or annual plans renew automatically until you cancel. Cancel anytime from your account; access continues through the period you already paid for."],
              ["What is the special offer?", "Ultimate is $19.99/mo for the first 3 months, then $24.99/mo. No countdown, no fake deadline."],
              ["Do one-time buys need a subscription?", "No. They are separate purchases."],
              ["If I'm on Ultimate, do I pay for one-time items?", "No — included items are included in Ultimate Co-Parent."],
              ["What happens to my data?", "Your drafts and records stay private. We never sell your data."],
            ].map(([q, a]) => (
              <div key={q} className="py-4">
                <p className="font-semibold text-ink">{q}</p>
                <p className="mt-1 text-base leading-relaxed text-stone">{a}</p>
              </div>
            ))}
          </div>
        </section>

        {msg && <p role="status" className="mt-5 rounded-xl bg-cream-deep p-4 text-ink">{msg}</p>}
        {purchased && (
          <a href="/home" className="btn-primary mt-5 block w-full text-center sm:w-auto">
            Open your Command Center →
          </a>
        )}
        {giftCode && (
          <div className="card mt-5 p-6">
            <p className="text-lg font-semibold text-ink">Your gift is ready.</p>
            <p className="mt-1 text-base text-stone">One month of Steady, for a dad who needs it.</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="rounded-xl border border-line bg-cream-deep px-4 py-3 font-mono text-lg font-semibold tracking-wider text-forest">{giftCode}</span>
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

        {/* Trust close-out (§9): renewals, cancel, privacy, not-legal-advice —
            all plainly stated in the decision context. */}
        <section className="card mt-12 p-6 text-stone">
          <p className="font-semibold text-ink">No pressure. No lock-in.</p>
          <p className="mt-1 text-base leading-relaxed">The free review always stays free. Your drafts and records are private.</p>
          <p className="mt-3 text-sm text-taupe">
            <a href="/trust" className="text-forest underline underline-offset-4">How privacy works</a> · Not legal advice.
          </p>
        </section>
      </main>
      <SiteFooter />
      {/* Mobile sticky CTA — NEVER hardwired to Ultimate (§12). Neutral
          "Choose a plan" until a meaningful selection (a plan card tap),
          then it reflects the selected plan + current price. Hidden for
          one-time deep links (the visitor came to buy a pack, not a plan). */}
      {!purchased && !deepTab && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream/95 px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
          <button
            onClick={() => (selected ? checkout(selected, isAnnual ? "year" : "month") : scrollToPlans())}
            className="btn-primary min-h-12 w-full text-base"
          >
            {selected && busy === `${selected}${isAnnual ? "year" : "month"}` ? "Opening checkout…" : stickyLabel}
          </button>
        </div>
      )}
    </div>
  );
}
