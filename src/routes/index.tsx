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
    // the variant); the VISUAL hero is now the single rolling-words headline
    // ("Panic, before you send" → "Think, before you send" → …) — the
    // variant is analytics-only, never a visual branch.
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

/* ---- The rolling-words headline (owner direction 2026-08-16) ----
   One calm headline: a rotating emotional-state word + ", before you send."
   — "Panic, before you send" → "Think, before you send" → "Breathe, before
   you send" → "Pause, before you send" → "Steady, before you send" → back
   to Panic. Father-centric and honest (naming the feeling is not promising
   an outcome); every word is a single short token so the swap never shifts
   layout. The rolling word lives in a fixed-width inline box sized by the
   LONGEST word ("Breathe") — NO layout shift at any swap. The tail
   ", before you send." is stable text beside it. prefers-reduced-motion
   renders the static first word ("Panic, before you send.") — no timers.
   The block is aria-hidden; the sr-only H1 carries the stable semantic
   phrase. The animation is pure texture: it never gates typing or the
   Review action (it is a sibling of the composer). */
const ROLLING_WORDS = ["Panic", "Think", "Breathe", "Pause", "Steady"] as const;
const T = { hold: 3600, fade: 500 };

function HeroRollingWords() {
  // Initial state is identical on server and client: first word visible
  // ("Panic"), second span hidden. The fixed-width rolling box is sized by
  // the longest word, so hydration and every swap are layout-stable.
  const [words, setWords] = useState<{ a: string; b: string; front: "a" | "b" }>({
    a: ROLLING_WORDS[0],
    b: ROLLING_WORDS[1],
    front: "a",
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    let i = 1;
    let t: number | undefined;
    const tick = () => {
      if (!alive) return;
      const word = ROLLING_WORDS[i % ROLLING_WORDS.length];
      i += 1;
      setWords((w) => {
        const nextFront: "a" | "b" = w.front === "a" ? "b" : "a";
        return {
          a: nextFront === "a" ? word : w.a,
          b: nextFront === "b" ? word : w.b,
          front: nextFront,
        };
      });
      // Hold the new word a full beat before the next swap (fade included).
      t = window.setTimeout(tick, T.hold + T.fade);
    };
    // Calm start: hold the first word a beat, then begin rotating.
    t = window.setTimeout(tick, T.hold);
    return () => {
      alive = false;
      if (t !== undefined) window.clearTimeout(t);
    };
  }, []);
  return (
    <span className="hero-rolling" aria-hidden="true">
      <span className={`hero-rolling-item ${words.front === "a" ? "on" : ""}`}>{words.a}</span>
      <span className={`hero-rolling-item ${words.front === "b" ? "on" : ""}`}>{words.b}</span>
      <span className="hero-rolling-tail">, before you send.</span>
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
          {/* Rolling-words headline — above and to the LEFT of the composer
              (stacked above, left-aligned on mobile). Purely visual: the
              composer below remains fully independent of the animation. */}
          <div className="hero-headline">
            <HeroRollingWords />
            <p className="hero-copy">
              Paste the draft. See how it may land — then send the calmer version.
            </p>
          </div>
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
