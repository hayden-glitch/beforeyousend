import { useEffect, useRef, useState, type ReactElement } from "react";
import { createFileRoute } from "@tanstack/react-router";
import ReviewTool from "~/components/ReviewTool";
import SortOneThingFree from "~/components/SortOneThingFree";
import Reveal from "~/components/Reveal";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import {
  IconAction,
  IconBook,
  IconCheck,
  IconChevronDown,
  IconLog,
  IconOrganizer,
  IconReview,
  IconTimeline,
} from "~/components/icons";
import { track } from "~/lib/analytics";
import { consultationMoney } from "~/lib/prices";
import { scrollBehavior } from "~/lib/motion";
import { seoHead } from "~/lib/seo";
export const Route = createFileRoute("/")({
  head: () => ({
    ...seoHead({
      title: "Before You Send — Review your message before you send it",
      description: "Paste the text you're about to send to your co-parent. Before You Send reviews how it may be received, flags conflict risks, and returns three calm, child-focused rewrites — free, no account needed.",
      path: "/",
    }),
    // Landing hero A/B/C split: assign bys_hero_variant (a|b|c, thirds, stable
    // per visitor) BEFORE first paint so no variant flashes. Sets
    // data-hero-variant on <html>; app.css shows exactly one H1 (default A).
    // Idempotent. The script also mirrors the CSS onto aria-hidden at
    // DOMContentLoaded so the hidden variants are out of the a11y tree even
    // for DOM-level audits (backlog 2ee6e58e). Visual + cookie behavior
    // unchanged from the a|b split.
    scripts: [
      { tag: "script", children: `(function(){try{var c=document.cookie.match(/(?:^|;\\s*)bys_hero_variant=([^;]+)/);var r=Math.random();var v=(c&&(c[1]==="a"||c[1]==="b"||c[1]==="c"))?c[1]:(r<1/3?"a":(r<2/3?"b":"c"));if(!c)document.cookie="bys_hero_variant="+v+"; Max-Age=31536000; Path=/; SameSite=Lax";document.documentElement.setAttribute("data-hero-variant",v);function ah(){var vs=["a","b","c"];for(var i=0;i<vs.length;i++){var el=document.querySelector("h1.hero-variant-"+vs[i]);if(el)el.setAttribute("aria-hidden",v===vs[i]?"false":"true")}}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",ah);else ah()}catch(e){}})();` },
      // The Organizer promo (100% since 2026-08-12 D3 — every free dad sees
      // the trial; stale "off" cookies from the 25% era are overridden).
      // Sibling script: never touches bys_hero_variant or bys_checkin.
      { tag: "script", children: `(function(){try{document.cookie="bys_org_trial=on; Max-Age=31536000; Path=/; SameSite=Lax";document.documentElement.setAttribute("data-organizer-promo","on");}catch(e){}})();` },
    ],
  }),
  component: Home,
});
const HERO_CLS = "font-display text-2xl font-semibold leading-[1.06] tracking-tight text-forest sm:text-[clamp(2.5rem,6.8vw,3.4rem)]";
function heroVariant(): "a" | "b" | "c" {
  if (typeof document === "undefined") return "a";
  const v = document.documentElement.getAttribute("data-hero-variant");
  return v === "b" || v === "c" ? v : "a";
}
// Signed-out landing tile fix (backlog 2900c5af): the Command Center module
// tiles must not dead-bounce a signed-out visitor off /home's auth gate. We
// learn the visitor's auth state once per mount (mirrors SiteChrome's
// checkSiteAuth — that helper is module-private) and point the tiles at
// /login?next=… when signed out, /home?tab=X when signed in. While the check
// is pending we default to the signed-out href — safe for everyone (a signed
// in click in that tiny window lands on /login, never a dead bounce).
function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me")
      .then(async (r) => {
        if (r.status === 401) return false;
        if (!r.ok) return false;
        const j = await r.json().catch(() => null);
        return !!(j && j.user);
      })
      .catch(() => false)
      .then((v) => { if (mounted) setSignedIn(v); });
    return () => { mounted = false; };
  }, []);
  return signedIn;
}
// Landing plan cards (below the fold). Benefit lists stay collapsed behind
// "All benefits" (audit TOP-10 #9 — no pricing wall-of-copy on the landing).
const LANDING_PLANS: { name: string; tag: string; price: string; per: string; benefits: string[]; cta: "review" | "pricing"; recommended?: boolean }[] = [
  { name: "Free", tag: "Start calm, stay consistent.", price: "$0", per: "/forever", benefits: ["First review always free — no account", "5 reviews per month with an account", "Saved history (last 10)", "Unlimited Communication Log + Timeline"], cta: "review" },
  { name: "Steady", tag: "For calmer communication, month after month.", price: "$4.99", per: "/mo", benefits: ["30 message reviews per month", "Unlimited review history", "Unlimited Communication Log and Timeline", "Email support from a real person"], cta: "pricing" },
  { name: "Command Center", tag: "Your complete organizing system — live today.", price: "$12.49", per: "/mo", benefits: ["Unlimited message reviews", "Document Organizer + smart tagging", "Case Summary — from your saved record", "Action Center — what needs your attention", "Export pack"], cta: "pricing" },
  { name: "Ultimate Co-Parent", tag: "Everything we offer. One plan. Set up for you.", price: "$24.99", per: "/mo", benefits: ["Unlimited message reviews", "Everything in Command Center", `1 free 45-minute consultation each year (${consultationMoney} value)`, "All one-time packs included", "Priority support + scheduling", "Kickstart onboarding and early access"], cta: "pricing", recommended: true },
];
function PlanCard({ p }: { p: (typeof LANDING_PLANS)[number] }) {
  return (
    <article className={`rounded-3xl border bg-card p-5 shadow-card ${p.recommended ? "border-2 border-forest" : "border-line"}`}>
      {p.recommended && <span className="inline-block rounded-full bg-forest px-3 py-1 text-xs font-semibold text-cream">Recommended — the complete system</span>}
      <h3 className="mt-3 font-display text-xl font-semibold text-forest">{p.name}</h3>
      <p className="mt-1 text-sm text-stone">{p.tag}</p>
      <p className="mt-3 font-display text-2xl font-semibold text-forest">{p.price}<span className="font-sans text-sm font-normal text-stone">{p.per}</span></p>
      <details className="mt-3 group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-forest [&::-webkit-details-marker]:hidden">
          All benefits
          <IconChevronDown className="h-5 w-5 text-forest-soft transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <ul className="mt-2 space-y-1.5 text-sm text-stone">
          {p.benefits.map((x) => (
            <li key={x} className="flex items-start gap-2">
              <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
              <span>{x}</span>
            </li>
          ))}
        </ul>
      </details>
      {p.cta === "review" ? (
        <button type="button" onClick={scrollToReview} className="btn-ghost mt-5 w-full">Start free</button>
      ) : (
        <a href="/pricing" className="btn-ghost mt-5 block w-full text-center">{p.recommended ? "Get Ultimate Co-Parent" : `Choose ${p.name}`}</a>
      )}
    </article>
  );
}
function scrollToReview() {
  track("hero_cta_click", { variant: heroVariant() });
  document.getElementById("review")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  setTimeout(() => document.getElementById("draft")?.focus({ preventScroll: true }), 450);
}
// ---- Interactive design layer (Phase 1) — calm scroll-triggered reveals.
// Each section is one Reveal unit (IntersectionObserver, threshold 0.25,
// play-once-and-settle). Content is VISIBLE BY DEFAULT: base states render
// everything; the reveal only adds motion (see .bys-reveal* in app.css).
// Copy here is calm and desirable — no limits, no fake claims.

const TONES: { name: string; line: string }[] = [
  { name: "Gentle", line: "I know last weekend was hard. Can we agree on a pick-up time that works for both of us?" },
  { name: "Direct", line: "Let's set the pick-up time now, so the kids know the plan." },
  { name: "Firm but Neutral", line: "We still need a pick-up time for Saturday. I'll confirm with you by Thursday either way." },
];

// Honest module list (matches the Command Center section copy + pricing):
// Log, Timeline, Organizer, Case Summary, and Action Center are all live.
// Tiles carry a tab id; ControlRoom builds the href from the visitor's auth
// state — signed-out clicks route to /login?next=/home?tab=X (login returns
// them into the module after sign-in) so the modules never dead-bounce.
const MODULES: { name: string; icon: (p: { className?: string }) => ReactElement; live: boolean; tab: string }[] = [
  { name: "Communication Log", icon: IconLog, live: true, tab: "log" },
  { name: "Event Timeline", icon: IconTimeline, live: true, tab: "timeline" },
  { name: "Document Organizer", icon: IconOrganizer, live: true, tab: "organizer" },
  { name: "Case Summary", icon: IconBook, live: true, tab: "case" },
  { name: "Action Center", icon: IconAction, live: true, tab: "action" },
];

// 1. The Cooling Message (flagship): one scroll demos the whole promise —
//    a hot draft lifts away, dots think, the calm reply settles in.
function CoolingMessage() {
  return (
    <section className="mb-12 mt-12">
      <Reveal>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">One pause</p>
        <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Hot in. Calm out.</h2>
        <p className="mt-3 text-base text-stone">The draft you almost sent — and the reply that goes instead.</p>
        <div className="relative mx-auto mt-8 max-w-[320px] rounded-[2.4rem] border border-line bg-card p-4 shadow-pop">
          <div className="flex items-center gap-2.5 border-b border-line/70 pb-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-forest/10 text-forest"><IconReview className="h-5 w-5" /></span>
            <span className="text-sm font-semibold text-ink">Co-parent</span>
          </div>
          <div className="bys-cool-stage">
            {/* The calm reply — always visible (this is the content). */}
            <span className="inline-flex items-center gap-1 rounded-full bg-forest px-2.5 py-0.5 text-[11px] font-semibold text-cream"><IconCheck className="h-3 w-3" />Gentle</span>
            <div className="bys-cool-calm mt-1.5 rounded-2xl rounded-tl-md border border-line bg-cream px-4 py-3 shadow-card">
              <p className="text-base leading-relaxed text-ink">I'm worried about how the schedule change affects the kids. Can we agree on a plan that works for both of us?</p>
            </div>
            {/* Motion layers (decorative, aria-hidden): hot draft + dots. */}
            <div className="bys-cool-hot rounded-2xl rounded-tl-md border border-amber-300 bg-amber-50 px-4 py-3 shadow-card" aria-hidden="true">
              <p className="text-base leading-relaxed text-amber-900">You're being unreasonable. The kids need a stable schedule and you keep ruining it.</p>
            </div>
            <div className="bys-cool-typing rounded-full border border-line bg-cream px-4 py-2.5 shadow-card" aria-hidden="true">
              <span className="bys-dot h-2 w-2 rounded-full bg-stone" />
              <span className="bys-dot h-2 w-2 rounded-full bg-stone" />
              <span className="bys-dot h-2 w-2 rounded-full bg-stone" />
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-stone">Before it's out there.</p>
        </div>
      </Reveal>
    </section>
  );
}

// 2. Three Tones — the three rewrites, rising staggered; each sample line
//    settles in after its card lands.
function ThreeTones() {
  return (
    <section className="mb-12 mt-12">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Three rewrites</p>
      <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Same message. Three tones.</h2>
      <p className="mt-3 text-base text-stone">Every version keeps the facts. Only the tone changes.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {TONES.map((t) => (
          <Reveal key={t.name} className="bys-tones-item">
            <article className="bys-tone-card h-full rounded-3xl border border-line bg-card p-5 shadow-card">
              <h3 className="font-display text-lg font-semibold text-forest">{t.name}</h3>
              <p className="bys-tone-line mt-3 text-base leading-relaxed text-ink">{t.line}</p>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// 3. Control Room — the Command Center's five modules light up in sequence:
//    live ones brighten as they land, coming-soon ones stay dim + chip.
//    Existing Command Center copy preserved byte-for-byte.
function ControlRoom() {
  const signedIn = useSignedIn();
  // Signed-out clicks go through /login with a next= deep link so the visitor
  // lands INSIDE the module after sign-in; signed-in clicks go straight there.
  const moduleHref = (tab: string) => (signedIn ? `/home?tab=${tab}` : `/login?next=/home?tab=${tab}`);
  return (
    <section className="mt-12 rounded-3xl border border-forest/15 bg-forest p-7 text-cream">
      <Reveal>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-cream/70">The Command Center</p>
        <h2 className="mt-3 font-display text-3xl font-semibold">Being a dad shouldn't be this hard.</h2>
        <p className="mt-3 text-base text-cream/85">We carry the organizing — so you can keep showing up. All five tools below are live.</p>
        <div className="bys-cr-grid mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {MODULES.map((m, i) => {
            const tileInner = (
              <>
                <span className="bys-tile-ic flex h-9 w-9 items-center justify-center rounded-xl bg-cream-deep/70 text-taupe">
                  <m.icon className="h-5 w-5" />
                </span>
                <p className="bys-tile-lb mt-2 break-words text-sm font-semibold leading-snug text-stone">{m.name}</p>
                <span className={`bys-tile-chip mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold text-stone ${m.live ? "bg-cream-deep" : "bg-cream-deep/70"}`}>{m.live ? "Live" : "Coming soon"}</span>
              </>
            );
            return m.live ? (
              <a
                key={m.name}
                href={moduleHref(m.tab)}
                onClick={() => track("landing_module_click", { module: m.name })}
                className={`bys-cr-tile bys-cr-live cursor-pointer rounded-2xl border border-line bg-card p-3 transition duration-200 hover:-translate-y-0.5 hover:border-forest/40${i === MODULES.length - 1 ? " max-sm:col-span-2" : ""}`}
              >
                {tileInner}
              </a>
            ) : (
              <div key={m.name} className={`bys-cr-tile rounded-2xl border border-line/80 bg-card p-3${i === MODULES.length - 1 ? " max-sm:col-span-2" : ""}`}>
                {tileInner}
              </div>
            );
          })}
        </div>
        <p className="mt-6 font-display text-2xl">We carry the burden. You just be a dad.</p>
      </Reveal>
    </section>
  );
}

function Home(){const reviewRef=useRef<HTMLElement|null>(null);useEffect(()=>{track("landing_page_visit",{});track("hero_view",{variant:heroVariant()});if(typeof window!=="undefined"&&new URLSearchParams(window.location.search).get("example")==="1"){const t=setTimeout(()=>{document.getElementById("review")?.scrollIntoView({behavior:scrollBehavior(),block:"start"});window.dispatchEvent(new CustomEvent("bys:example"))},150);return()=>clearTimeout(t)}},[]);return <div className="min-h-dvh"><SiteHeader active="home" /><main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-5 sm:px-6"><section className="pb-4 pt-6 sm:pt-12"><h1 className={`hero-variant-a ${HERO_CLS}`}><span className="sm:hidden">For your situation. Your calm reply.</span><span className="hidden sm:inline">Your message. Your situation. Your calm reply.</span></h1><h1 className={`hero-variant-b ${HERO_CLS}`}><span className="sm:hidden">Your 11pm draft can wait until morning.</span><span className="hidden sm:inline">The message you wrote at 11pm doesn't have to be the one you send.</span></h1><h1 className={`hero-variant-c ${HERO_CLS}`}><span className="sm:hidden">See how it could sound in court — before you send.</span><span className="hidden sm:inline">Before you send that message, see how it could sound in court — or to your co-parent.</span></h1></section><ReviewTool reviewRef={reviewRef}/><SortOneThingFree/><CoolingMessage/><section className="mb-12 mt-12"><h2 className="font-display text-3xl font-semibold text-forest">How it works</h2><ol className="mt-5 space-y-4 text-base text-ink"><li><b>Paste your draft.</b> The message you're about to send — a text, an email, anything.</li><li><b>See how it lands.</b> An honest read on tone, what could escalate, and the facts worth keeping.</li><li><b>Send the calm version.</b> Choose Gentle, Direct, or Firm but Neutral — and send with your head up.</li></ol></section><ThreeTones/><section className="mb-12"><ul className="grid gap-4 text-base text-ink sm:grid-cols-2"><li><b>Stay calm when it matters.</b> See how your words land — then send the calmer version.</li><li><b>Keep the record straight.</b> A log that shows you were consistent and focused on the kids.</li><li><b>Protect what matters.</b> Escalation flags catch the loaded words before they become a problem.</li><li><b>Sleep at night.</b> Get the calm version in seconds — not at 11pm.</li></ul></section><ControlRoom/><section className="mt-12 rounded-3xl border border-line bg-card p-6"><p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">How we behave</p><p className="mt-3 text-base leading-relaxed text-ink">No invented testimonials. No outcome promises. Not legal advice. No pressure — the free review stays free, and you can cancel anytime.</p><p className="mt-3 text-base leading-relaxed text-stone">Live now: free review, saved history, Communication Log, Event Timeline, Document Organizer, Case Summary, Action Center, consultations. Everything else is honestly marked 'coming soon'.</p></section><section className="mt-12"><p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Simple, honest pricing</p><h2 className="mt-3 font-display text-3xl font-semibold text-forest">Four ways to be the calm one.</h2><p className="mt-3 text-base text-stone">Every plan starts with a free review that always stays free.</p><div className="mt-6 grid gap-3 sm:grid-cols-2">{LANDING_PLANS.map((p) => <PlanCard key={p.name} p={p} />)}</div></section><section className="pb-12 pt-12"><div className="rounded-3xl border border-line bg-cream-deep/60 p-7"><p className="font-display text-2xl font-semibold text-forest">Your next message can be the calm one.</p><p className="mt-3 text-base text-stone">See how it lands before you send it — free, in seconds.</p><button onClick={scrollToReview} className="btn-primary mt-5">Review it — free</button><p className="mt-6 border-t border-line/70 pt-5 text-sm leading-relaxed text-stone"><span className="font-semibold text-forest">Built for dads who just want to be dads.</span></p></div></section></main><SiteFooter /></div>}
