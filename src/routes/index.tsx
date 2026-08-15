import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import ReviewTool from "~/components/ReviewTool";
import { SiteFooter, SiteHeader } from "~/components/SiteChrome";
import { track } from "~/lib/analytics";
import { scrollBehavior } from "~/lib/motion";
import { seoHead } from "~/lib/seo";

export const Route = createFileRoute("/")({
  head: () => ({
    ...seoHead({
      title: "Before You Send — Review your message before you send it",
      description:
        "Paste the text you're about to send. See how it may be received, flag what could escalate, and get three calm, child-focused rewrites — free, no account needed.",
      path: "/",
    }),
    // Landing hero A/B/C split (bys_hero_variant cookie): the head script
    // assigns a|b|c before first paint and sets data-hero-variant on <html>.
    // Kept for funnel analytics continuity (hero_view / hero_cta_click carry
    // the variant); the visual hero itself is now the single brand + Panic
    // state per 5304729186 §2.
    scripts: [
      { tag: "script", children: `(function(){try{var c=document.cookie.match(/(?:^|;\\s*)bys_hero_variant=([^;]+)/);var r=Math.random();var v=(c&&(c[1]==="a"||c[1]==="b"||c[1]==="c"))?c[1]:(r<1/3?"a":(r<2/3?"b":"c"));if(!c)document.cookie="bys_hero_variant="+v+"; Max-Age=31536000; Path=/; SameSite=Lax";document.documentElement.setAttribute("data-hero-variant",v);}catch(e){}})();` },
      // The Organizer promo (100% since 2026-08-12 D3 — every free dad sees
      // the trial; stale "off" cookies from the 25% era are overridden).
      // Sibling script: never touches bys_hero_variant or bys_checkin.
      { tag: "script", children: `(function(){try{document.cookie="bys_org_trial=on; Max-Age=31536000; Path=/; SameSite=Lax";document.documentElement.setAttribute("data-organizer-promo","on");}catch(e){}})();` },
    ],
  }),
  component: Home,
});

function heroVariant(): "a" | "b" | "c" {
  if (typeof document === "undefined") return "a";
  const v = document.documentElement.getAttribute("data-hero-variant");
  return v === "b" || v === "c" ? v : "a";
}

function scrollToReview() {
  track("hero_cta_click", { variant: heroVariant() });
  document.getElementById("review")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  setTimeout(() => document.getElementById("draft")?.focus({ preventScroll: true }), 450);
}

/* ---- The required Panic animation (5304729186 §2) ----
   "Panic." sits in the hero as the emotional state, stays readable
   ~1.8s, a red strike draws across it (~550ms), then a calm positive
   word settles in the same visual position. ONE replacement word per
   page load (module-level cache — remounts keep the same word, never
   loops). Both words share one grid cell so the container is sized by
   the widest — no layout shift. The whole block is aria-hidden; the
   H1 carries one stable semantic phrase. prefers-reduced-motion
   renders the resolved calm state immediately (no timers, no strike). */
const CALM_WORDS = ["Think.", "Breathe.", "Pause.", "Respond."] as const;
let calmWordForPage: string | null = null;
function pickCalmWord(): string {
  if (!calmWordForPage) {
    calmWordForPage = CALM_WORDS[Math.floor(Math.random() * CALM_WORDS.length)];
  }
  return calmWordForPage;
}
type HeroPhase = "panic" | "strike" | "calm";
function HeroState() {
  // Initial state is identical on server and client ("Think." is a stable
  // placeholder that is never visible — opacity 0). The real word is picked
  // client-side right after mount, so hydration never mismatches and the
  // container width is stable from first paint (widest word reserves space).
  const [phase, setPhase] = useState<HeroPhase>("panic");
  const [calm, setCalm] = useState<string>(CALM_WORDS[0]);
  useEffect(() => {
    setCalm(pickCalmWord());
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("calm");
      return;
    }
    let alive = true;
    const t1 = window.setTimeout(() => { if (alive) setPhase("strike"); }, 1800);
    const t2 = window.setTimeout(() => { if (alive) setPhase("calm"); }, 1800 + 550);
    return () => {
      alive = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  return (
    <span className="hero-state" data-phase={phase} aria-hidden="true">
      <span className="hero-word hero-state-panic">Panic.</span>
      <span className="hero-word hero-state-calm">{calm}</span>
      <span className="hero-strike" />
    </span>
  );
}

/* ---- The three ideas (5304729186 §2) — three distinct compositions,
   headline + one sentence each. No identical cards. ---- */

// 1. Review — a struck hot draft settles into the calm line.
function IdeaReview() {
  return (
    <section className="mt-16 sm:mt-24">
      <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Review — make the message clearer.</h2>
      <p className="mt-2 max-w-md text-stone">See how your words land, keep the facts, send the calmer version.</p>
      <div className="mt-6 max-w-xl rounded-[14px] border border-line bg-card p-5 shadow-card sm:p-6">
        <p className="text-base leading-relaxed text-stone line-through decoration-red-500/90 decoration-2">
          You keep ruining the schedule. The kids deserve better than this.
        </p>
        <p className="mt-4 border-t border-line pt-4 text-base leading-relaxed text-ink">
          I'd like to settle a schedule that works for both of us. Can we talk it through this week?
        </p>
      </div>
    </section>
  );
}

// 2. Record — a quiet ledger of rows and rules, not a pile of cards.
const LEDGER_ROWS: { date: string; title: string; kind: string }[] = [
  { date: "Aug 12", title: "Draft review — calm version sent", kind: "Review" },
  { date: "Aug 10", title: "Pick-up change", kind: "Log" },
  { date: "Aug 04", title: "Parenting plan", kind: "Document" },
];
function IdeaRecord() {
  return (
    <section className="mt-16 sm:mt-24">
      <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Record — keep what matters organized.</h2>
      <p className="mt-2 max-w-md text-stone">Messages, events, and documents — dated and filed as they happen.</p>
      <div className="mt-6 max-w-xl overflow-hidden rounded-[14px] border border-line bg-card shadow-card">
        {LEDGER_ROWS.map((r, i) => (
          <div
            key={r.title}
            className={`grid grid-cols-[5.5rem_1fr_auto] items-baseline gap-3 px-5 py-3.5 sm:grid-cols-[6.5rem_1fr_auto] ${
              i > 0 ? "border-t border-line" : ""
            }`}
          >
            <span className="text-xs text-taupe">{r.date}</span>
            <span className="min-w-0 truncate text-ink">{r.title}</span>
            <span className="text-xs text-stone">{r.kind}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// 3. Prepare — one document surface with a quiet export affordance.
function IdeaPrepare() {
  return (
    <section className="mt-16 sm:mt-24">
      <h2 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">Prepare — turn the record into something usable.</h2>
      <p className="mt-2 max-w-md text-stone">Case summaries and export packs, built from what you've kept.</p>
      <div className="mt-6 max-w-xl overflow-hidden rounded-[14px] border border-line bg-card shadow-card">
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-5 py-4">
          <span className="font-semibold text-ink">Case summary</span>
          <span className="text-xs text-taupe">Updated today</span>
        </div>
        <div className="space-y-3 px-5 py-5">
          <p className="text-sm leading-relaxed text-stone">Key events this quarter, in order.</p>
          <p className="text-sm leading-relaxed text-stone">Messages and documents that back each point.</p>
          <p className="text-sm leading-relaxed text-stone">Ready to share or print.</p>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <span className="text-xs text-taupe">Timeline · Log · Documents</span>
          <span className="text-sm font-semibold text-forest">Export</span>
        </div>
      </div>
    </section>
  );
}

function Home() {
  const reviewRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    track("landing_page_visit", {});
    track("hero_view", { variant: heroVariant() });
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("example") === "1") {
      const t = setTimeout(() => {
        document.getElementById("review")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
        window.dispatchEvent(new CustomEvent("bys:example"));
      }, 150);
      return () => clearTimeout(t);
    }
  }, []);
  return (
    <div className="min-h-dvh">
      <SiteHeader active="home" />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-3xl px-5 sm:px-6">
        {/* Hero — brand → Panic state → one support line → CTAs → trust row.
            No floating product objects here (5304729186 §2). */}
        <section className="pb-14 pt-14 sm:pb-16 sm:pt-20">
          <h1 className="max-w-2xl font-display text-[clamp(1.9rem,5.4vw,2.9rem)] font-semibold leading-[1.06] tracking-tight text-ink">
            Before You Send
            <span className="sr-only"> — turns panic into a deliberate response.</span>
          </h1>
          <p className="mt-5 font-display text-[clamp(2.5rem,7.4vw,4.1rem)] font-semibold leading-none tracking-tight text-ink">
            <HeroState />
          </p>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-stone">
            See how your words land before you send.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button type="button" onClick={scrollToReview} className="btn-primary">
              Review a message
            </button>
            <a href="/pricing" className="btn-ghost">
              View plans
            </a>
          </div>
          <ul className="mt-9 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-stone">
            <li>First review free</li>
            <li aria-hidden="true" className="text-taupe">·</li>
            <li>No account needed</li>
            <li aria-hidden="true" className="text-taupe">·</li>
            <li>Not legal advice</li>
          </ul>
        </section>

        {/* The working tool — one restrained application surface (the primary
            CTA above lands here). */}
        <section id="review" ref={reviewRef} className="scroll-mt-24">
          <ReviewTool reviewRef={reviewRef} />
        </section>

        {/* Three ideas — Review / Record / Prepare, each a distinct composition. */}
        <IdeaReview />
        <IdeaRecord />
        <IdeaPrepare />

        {/* Final CTA — one headline, one action. */}
        <section className="mt-16 border-t border-line pb-16 pt-12 sm:mt-24 sm:pb-20 sm:pt-16">
          <h2 className="max-w-xl font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Your next message can be the calm one.
          </h2>
          <p className="mt-3 max-w-md text-stone">See how it lands before you send it — free.</p>
          <div className="mt-6">
            <button type="button" onClick={scrollToReview} className="btn-primary">
              Review a message
            </button>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
