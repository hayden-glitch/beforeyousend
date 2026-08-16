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
    // the variant); the VISUAL hero is now the single spec-§4 Panic→X→Calm
    // state — the variant is analytics-only, never a visual branch.
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

/* ---- The Panic animation (spec §4, exact timings) ----
   Sequence: hold `Panic.` 2800ms → first X diagonal draws 600ms → pause
   200ms → second diagonal draws 600ms → hold crossed 900ms → resolve
   1500ms (panic word fades, X fades) → calm word in (600ms crossfade).
   Calm words rotate every 4000ms with a 600ms soft crossfade;
   `Panic.` re-enters every 5th rotation and is ALWAYS resolved by the red X.
   `Panic.` is an inline SVG text with a subtle static displacement filter
   (grease-pencil wobble — adult, not cartoonish, zero font download). All
   words share one grid cell sized by the panic SVG's 5.6em width — NO layout
   shift at any phase. The block is aria-hidden; the H1 carries the stable
   semantic phrase. prefers-reduced-motion renders the resolved calm state
   immediately (no timers, no X). The animation is pure texture: it never
   gates typing or the Review action (it is a sibling of the composer). */
const CALM_WORDS = ["Calm.", "Think.", "Breathe.", "Pause.", "Respond.", "Steady.", "Clear."] as const;
const PANIC = "__PANIC__";
const T = { holdPanic: 2800, s1: 600, gap: 200, s2: 600, crossed: 900, resolve: 1500, calmHold: 4000, fade: 600 };
type HeroPhase = "panic" | "x1" | "x2" | "crossed" | "resolve" | "calm";

function buildHeroCycle(): string[] {
  const out: string[] = [PANIC];
  for (let i = 0; i < 26; i++) {
    if (i > 0 && i % 5 === 0) out.push(PANIC);
    out.push(CALM_WORDS[i % CALM_WORDS.length]);
  }
  return out;
}

function HeroState() {
  // Initial state is identical on server and client: phase "panic", both calm
  // spans hidden, panic SVG + (later) the X over the cell. The cell is always
  // 5.6em wide (the panic SVG) — wider than any calm word — so hydration and
  // every phase change are layout-stable.
  const [phase, setPhase] = useState<HeroPhase>("panic");
  const [words, setWords] = useState<{ a: string; b: string; front: "a" | "b" }>({
    a: CALM_WORDS[0],
    b: CALM_WORDS[1],
    front: "a",
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPhase("calm");
      return;
    }
    let alive = true;
    const timeouts: number[] = [];
    const later = (ms: number, fn: () => void) => {
      timeouts.push(window.setTimeout(() => { if (alive) fn(); }, ms));
    };
    const cycle = buildHeroCycle();
    function crossfade(word: string) {
      setWords((w) => {
        const nextFront: "a" | "b" = w.front === "a" ? "b" : "a";
        return {
          a: nextFront === "a" ? word : w.a,
          b: nextFront === "b" ? word : w.b,
          front: nextFront,
        };
      });
    }
    function showCalm(word: string, done: () => void) {
      setPhase("calm");
      crossfade(word);
      later(T.calmHold + T.fade, done);
    }
    function showPanic(done: () => void) {
      setPhase("panic");
      later(T.holdPanic, () => setPhase("x1"));
      later(T.holdPanic + T.s1 + T.gap, () => setPhase("x2"));
      later(T.holdPanic + T.s1 + T.gap + T.s2, () => setPhase("crossed"));
      later(T.holdPanic + T.s1 + T.gap + T.s2 + T.crossed, () => setPhase("resolve"));
      later(T.holdPanic + T.s1 + T.gap + T.s2 + T.crossed + T.resolve, done);
    }
    function run(i: number) {
      const item = cycle[i % cycle.length];
      if (item === PANIC) showPanic(() => run(i + 1));
      else showCalm(item, () => run(i + 1));
    }
    // Perf (D10, red-team blocker #2): the §4 sequence is texture, not
    // function — the composer works regardless of when it starts. Arm the
    // cycle after a short quiet window (max ~1200ms) instead of immediately
    // on hydration, so the anonymous-load main thread stays quiet through
    // the measured window. "Panic." is the first state either way, relative
    // §4 timings are unchanged, and reduced-motion renders calm instantly.
    let id: number | undefined;
    const start = () => {
      if (alive) run(0);
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (n: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      id = w.requestIdleCallback(start, { timeout: 1200 });
    } else {
      id = window.setTimeout(start, 1000);
    }
    return () => {
      alive = false;
      timeouts.forEach((t) => window.clearTimeout(t));
      if (typeof w.requestIdleCallback === "function" && id !== undefined) {
        w.cancelIdleCallback?.(id);
      } else if (id !== undefined) {
        window.clearTimeout(id);
      }
    };
  }, []);
  return (
    <span className="hero-state" data-phase={phase} aria-hidden="true">
      <span className={`hero-calm-item ${phase === "calm" && words.front === "a" ? "on" : ""}`}>{words.a}</span>
      <span className={`hero-calm-item ${phase === "calm" && words.front === "b" ? "on" : ""}`}>{words.b}</span>
      <svg className="hero-panic-svg" viewBox="0 0 560 140" aria-hidden="true" focusable="false">
        <defs>
          <filter id="bys-hero-crayon" x="-8%" y="-14%" width="116%" height="128%">
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="11" result="wobble" />
            <feDisplacementMap in="SourceGraphic" in2="wobble" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <text className="hero-panic-text" x="50%" y="52%" textAnchor="middle" dominantBaseline="central" filter="url(#bys-hero-crayon)">
          Panic.
        </text>
      </svg>
      <svg className="hero-x" viewBox="0 0 120 60" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line className="s1" x1="6" y1="8" x2="114" y2="52" />
        <line className="s2" x1="114" y1="8" x2="6" y2="52" />
      </svg>
    </span>
  );
}

/* ---- The product narrative (spec §8) — one connected chain:
   message → better response → organized record → useful preparation.
   Real product data shapes; no decorative illustration, no matching cards. ---- */
const LEDGER_ROWS: { date: string; title: string; kind: string }[] = [
  { date: "Aug 12", title: "Draft review — calm version sent", kind: "Review" },
  { date: "Aug 10", title: "Pick-up change", kind: "Log" },
  { date: "Aug 04", title: "Parenting plan", kind: "Document" },
];

function ChainArrow() {
  return (
    <div className="chain-arrow" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    </div>
  );
}

function Narrative() {
  return (
    <section className="narrative" aria-label="What happens after you review">
      <h2>One message, then a record that works for you.</h2>
      <p className="lede">Review the draft. Send the calmer version. Keep it on the record. Be ready when it matters.</p>
      <div className="chain">
        <div className="chain-step">
          <span className="k">Review</span>
          <p className="msg-draft">
            <span className="strike">You keep ruining the schedule. The kids deserve better than this.</span>
          </p>
          <p className="msg-calm">“I’d like to settle a schedule that works for both of us. Can we talk it through this week?”</p>
        </div>
        <ChainArrow />
        <div className="chain-step">
          <span className="k">Record</span>
          {LEDGER_ROWS.map((r) => (
            <div key={r.title} className="ledger-row">
              <span className="d">{r.date}</span>
              <span className="t">{r.title}</span>
              <span className="k2">{r.kind}</span>
            </div>
          ))}
        </div>
        <ChainArrow />
        <div className="chain-step">
          <span className="k">Prepare</span>
          <p className="summary-line">
            <b>Case summary</b> — key events this quarter, in order, each backed by the message or document.
          </p>
          <div className="summary-meta">
            <span>Timeline · Log · Documents</span>
            <span className="exp">Export</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function FinalCTA() {
  return (
    <section className="final-cta">
      <h2>Your next message can be the calm one.</h2>
      <p className="sub">See how it lands before you send it — free.</p>
      <button type="button" onClick={scrollToReview} className="btn-primary">
        Review a message
      </button>
      <p className="editorial">The record you keep quietly is the one that speaks later.</p>
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
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1180px] px-4 sm:px-6">
        {/* Single product scene (spec §3): emotional hero state → one promise →
            the working composer as the central plane → primary action →
            trust line adjacent → See plans. The visitor never scrolls to
            reach the product; the composer IS the page. */}
        <section className="hero" aria-label="Before You Send">
          <h1 className="sr-only">See how your message may land before you send it.</h1>
          <HeroState />
          <p className="hero-copy">
            See how your message may land <strong>before you send it.</strong>
          </p>
          <div className="workplane mt-7 sm:mt-9">
            <ReviewTool reviewRef={reviewRef} />
          </div>
          <p className="trust-line">
            <span>First review free</span>
            <span className="sep" aria-hidden="true">·</span>
            <span>No account</span>
            <span className="sep" aria-hidden="true">·</span>
            <span>Private</span>
            <span className="sep" aria-hidden="true">·</span>
            <a href="/trust">How privacy works</a>
          </p>
          <p className="hero-second">
            <a href="/pricing">See plans</a>
          </p>
        </section>

        {/* One connected narrative — Review → Record → Prepare. */}
        <Narrative />

        {/* Final CTA — one headline, one action (serif editorial accent only). */}
        <FinalCTA />
      </main>
      <SiteFooter />
    </div>
  );
}
