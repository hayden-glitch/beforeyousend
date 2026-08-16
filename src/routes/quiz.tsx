import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import { EMAIL_RE, confirmPath, saveReview } from "~/lib/api";

// Hidden ad-landing quiz "Are you a good co-parent?" (owner-approved, 2026-08).
// Deliberately a standalone page: NO SiteChrome (no header pill nav, no footer
// links), robots noindex so organic search never surfaces it, and the Special
// Offer modal is suppressed via suppressForPath() (/quiz added there). Fully
// client-side + deterministic — zero LLM cost/abuse surface, exactly like the
// landing "Sort one thing free" demo. The grade is KIND but ACCURATE per the
// fixed rubric; the free-account card is the REAL free tier via the existing
// /api/save capture API (email → signup row → confirm token → /confirm creates
// the account). Honesty rails: no urgency, no fabricated claims, no price talk,
// never "premium for free".

export const Route = createFileRoute("/quiz")({
  head: () => ({
    meta: [
      { title: "Be honest. Are you a good co-parent?" },
      {
        name: "description",
        content:
          "5 quick questions. No right answers — just how you actually handle it. You get a grade, a laugh, and something useful.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Quiz,
});

// ── Rubric (deterministic, owner-specified; do not rebalance) ───────────────

type Choice = { label: string; points: number };
type Question = { id: string; dimension: string; label: string; choices: Choice[] };

const QUESTIONS: Question[] = [
  {
    id: "q1",
    dimension: "communication",
    label: "Your co-parent texts something that gets under your skin, at 9pm. What do you do?",
    choices: [
      { label: "Fire back right away — they started it.", points: 1 },
      { label: "Draft it, sit on it overnight, send a calmer version in the morning.", points: 4 },
      { label: "Reply immediately, keep it neutral.", points: 3 },
      { label: "Call a friend, vent, then reply.", points: 2 },
      { label: "Don't reply at all for a week.", points: 1 },
    ],
  },
  {
    id: "q2",
    dimension: "kids-out-of-the-middle",
    label: "Your kid mentions something their mom said about you. You…",
    choices: [
      { label: "Ask for details — you need to know.", points: 2 },
      { label: "Say “that's between grown-ups” and change the subject.", points: 4 },
      { label: "Set the record straight with your kid right there.", points: 1 },
      { label: "Bring it up with your co-parent later, calmly, away from the kids.", points: 3 },
      { label: "Laugh it off and change the subject.", points: 2 },
    ],
  },
  {
    id: "q3",
    dimension: "documentation",
    label: "After a rough exchange, do you write down what happened?",
    choices: [
      { label: "Always — date, time, what was said.", points: 4 },
      { label: "Usually, when I remember.", points: 3 },
      { label: "Only if it was really bad.", points: 2 },
      { label: "I replay it in my head but never write it down.", points: 1 },
      { label: "I'd rather move on.", points: 1 },
    ],
  },
  {
    id: "q4",
    dimension: "consistency",
    label: "Pickup was a mess — the kid's bag was missing and you were late. You…",
    choices: [
      { label: "Text a detailed list of everything that went wrong.", points: 1 },
      { label: "Fix what you can, note it calmly, move on.", points: 4 },
      { label: "Vent to your kid about it on the drive.", points: 0 },
      { label: "Mention it briefly, no lecture.", points: 3 },
    ],
  },
  {
    id: "q5",
    dimension: "self-care",
    label: "You're exhausted and your patience is gone. The next message from your co-parent will probably…",
    choices: [
      { label: "Get the full force of your mood.", points: 0 },
      { label: "Get the calmer version — you wait before sending.", points: 4 },
      { label: "Be short and clipped.", points: 2 },
      { label: "Be written now, sent in the morning.", points: 3 },
    ],
  },
];

// Tie-break order for the lowest-scoring dimension (owner spec: first in this
// exact order). MUST match the dimensions above.
const DIM_ORDER = ["communication", "kids-out-of-the-middle", "documentation", "consistency", "self-care"];
const DIM_LABELS: Record<string, string> = {
  communication: "Communication",
  "kids-out-of-the-middle": "Keeping the kids out of the middle",
  documentation: "Documentation",
  consistency: "Consistency",
  "self-care": "Being the calm one",
};
const FIXES: Record<string, string> = {
  communication: "Draft it, sit on it, send it calmer — your message tool does this for you.",
  "kids-out-of-the-middle": "Keep the kids out of the middle — one calm line to your co-parent beats ten to your kid.",
  documentation: "Start writing it down — date, time, what was said. Your record is your armor.",
  consistency: "Pick one calm, brief note after a rough exchange. No lecture, no list.",
  "self-care": "You can't be the calm one on empty — wait before you send. Future you agrees.",
};

type BandKey = "calm" | "steady" | "working" | "trenches";
type Band = { key: BandKey; name: string; read: string; jokes: string[]; improvement: (dims: string[]) => string };

const BANDS: Record<BandKey, Band> = {
  calm: {
    key: "calm",
    name: "The Calm One",
    read: "You're the calm in the storm. Honestly, we're a little impressed.",
    jokes: [
      "Your co-parenting score beat your phone battery. Charge both.",
      "Somewhere out there, a mediator is taking notes from you.",
      "You're the dad other dads pretend to be. Keep it up.",
    ],
    improvement: () => "Keep documenting and logging — your record is your armor. Keep it current.",
  },
  steady: {
    key: "steady",
    name: "Steady & Building",
    read: "Solid. You handle most of this well — and a couple of spots are quietly costing you.",
    jokes: [
      "You're the dad who reads the instructions first. Weird. We love it.",
      "Almost perfect — which, in co-parenting, is basically a trophy.",
      "Your report card says “great with kids, needs a nap.”",
    ],
    improvement: (dims) => `Start here — ${DIM_LABELS[dims[0]]}: ${FIXES[dims[0]]}`,
  },
  working: {
    key: "working",
    name: "Working On It (Like Most of Us)",
    read: "You showed up and took the quiz — that's more than half the battle.",
    jokes: [
      "If co-parenting were a video game, you'd be past the tutorial. Barely. No judgment.",
      "You're not failing — you're just playing on hard mode without the guide.",
      "Most dads never even take the quiz. You already won that round.",
    ],
    improvement: (dims) =>
      dims.length > 1
        ? `Two places to start — ${DIM_LABELS[dims[0]]}: ${FIXES[dims[0]]} And ${DIM_LABELS[dims[1]]}: ${FIXES[dims[1]]}`
        : `Start here — ${DIM_LABELS[dims[0]]}: ${FIXES[dims[0]]}`,
  },
  trenches: {
    key: "trenches",
    name: "In the Trenches — Real Effort",
    read: "Rough patch. Real effort. The fact that you're here means you care.",
    jokes: [
      "You answered honestly. That's 90% of the battle. The other 10% is remembering to log the exchange.",
      "You showed up — that's more than a lot of people do on their best day.",
      "Every good co-parenting story starts with a dad who admitted it was hard. You just did.",
    ],
    improvement: (dims) =>
      dims.length > 1
        ? `Start here, one thing at a time: ${FIXES[dims[0]]} When that feels normal. ${FIXES[dims[1]]}`
        : `Start here, one thing at a time: ${FIXES[dims[0]]}`,
  },
};

function computeResult(answers: number[]) {
  const perDim: Record<string, number> = {};
  QUESTIONS.forEach((q, i) => {
    perDim[q.dimension] = q.choices[answers[i]].points;
  });
  const total = answers.reduce((s, a, i) => s + QUESTIONS[i].choices[a].points, 0);
  const bandKey: BandKey =
    total >= 18 ? "calm" : total >= 14 ? "steady" : total >= 9 ? "working" : "trenches";
  // Lowest dimension(s), ties broken by DIM_ORDER (first wins).
  const sorted = [...DIM_ORDER].sort((a, b) => perDim[a] - perDim[b]);
  const lowestScore = perDim[sorted[0]];
  let dims = [sorted[0]];
  if (bandKey !== "calm" && perDim[sorted[1]] <= lowestScore + 1) dims.push(sorted[1]);
  if (bandKey === "steady") dims = [sorted[0]]; // Steady names only the single lowest
  const band = BANDS[bandKey];
  const joke = band.jokes[total % band.jokes.length];
  return { total, bandKey, band, dims, joke };
}

// ── Session resume (refresh mid-quiz → same spot, same answers) ─────────────

const STORAGE_KEY = "bys_quiz_v1";
type Saved = { step: number; answers: number[] };
// step: -1 = welcome, 0..4 = question index, 5 = grade
function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (typeof s?.step !== "number" || !Array.isArray(s?.answers)) return null;
    return s;
  } catch {
    return null;
  }
}
function persist(state: Saved) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}
function clearSaved() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

// ── Component ───────────────────────────────────────────────────────────────

function Quiz() {
  const savedRef = useRef<Saved | null>(null);
  if (savedRef.current === null && typeof window !== "undefined") savedRef.current = loadSaved();
  const [step, setStep] = useState<number>(() => (savedRef.current ? savedRef.current.step : -1));
  const [answers, setAnswers] = useState<number[]>(() => (savedRef.current ? savedRef.current.answers : []));
  const [selected, setSelected] = useState<number | null>(null);
  const [seen, setSeen] = useState(false);

  // Email capture (free account — the real free tier via /api/save).
  const [email, setEmail] = useState("");
  const [capState, setCapState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [capError, setCapError] = useState("");
  const [existingAccount, setExistingAccount] = useState(false);
  const [confirmLink, setConfirmLink] = useState("");

  // quiz_viewed (source=quiz, once per mount).
  useEffect(() => {
    track("quiz_viewed", { source: "quiz" });
  }, []);

  // quiz_grade_shown fires once when the grade screen mounts (band in meta).
  useEffect(() => {
    if (step === 5 && !seen) {
      setSeen(true);
      const res = computeResult(answers);
      track("quiz_grade_shown", { source: "quiz", band: res.bandKey, score: res.total });
    }
  }, [step, answers, seen]);

  const start = () => {
    track("quiz_started", { source: "quiz" });
    setStep(0);
    setAnswers([]);
    persist({ step: 0, answers: [] });
  };

  // Tap a choice: highlight instantly, then auto-advance after a short beat
  // (fast, game-like; reduced-motion users get the same quick beat — it's
  // timing, not motion). Double-taps are ignored via the `selected` guard.
  const pick = (ci: number) => {
    if (selected !== null) return;
    setSelected(ci);
    const q = step; // 0..4
    const next = [...answers, ci];
    track("quiz_answered", { source: "quiz", q: q + 1 });
    window.setTimeout(() => {
      if (q + 1 < QUESTIONS.length) {
        setStep(q + 1);
        setAnswers(next);
        persist({ step: q + 1, answers: next });
      } else {
        setAnswers(next);
        setStep(5);
        persist({ step: 5, answers: next });
        track("quiz_completed", { source: "quiz", score: computeResult(next).total, band: computeResult(next).bandKey });
      }
      setSelected(null);
    }, 420);
  };

  const restart = () => {
    clearSaved();
    setStep(-1);
    setAnswers([]);
    setSelected(null);
    setEmail("");
    setCapState("idle");
    setCapError("");
    setExistingAccount(false);
    setConfirmLink("");
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  const submitEmail = async (e: FormEvent) => {
    e.preventDefault();
    const value = email.trim().toLowerCase();
    if (!value) {
      setCapState("error");
      setCapError("Enter your email so we can get you in.");
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setCapState("error");
      setCapError("That email doesn't look right — double-check it.");
      return;
    }
    setCapState("saving");
    setCapError("");
    setExistingAccount(false);
    try {
      const res = await saveReview(value, "", "");
      if (res.ok) {
        setConfirmLink(confirmPath(res.token, res.link));
        setCapState("saved");
        track("email_submitted", { source: "quiz" });
      } else {
        const msg = res.error || res.message || "Couldn't save right now — please try again.";
        setCapError(msg);
        if (typeof msg === "string" && /already has an account/i.test(msg)) setExistingAccount(true);
        setCapState("error");
      }
    } catch {
      setCapError("Couldn't save right now — please try again.");
      setCapState("error");
    }
  };

  const answered = answers.length;

  // Welcome screen (step -1)
  if (step === -1) {
    return (
      <QuizShell>
        <LogoMark />
        <h1 className="mt-6 text-center font-display text-4xl font-semibold leading-[1.08] tracking-tight text-forest sm:text-5xl">
          <span className="block">Be honest.</span>
          <span className="block">Are you a good</span>
          <span className="block">Co-Parent?</span>
        </h1>
        <p className="mt-4 text-center text-base leading-relaxed text-stone sm:text-lg">
          5 quick questions. No right answers — just how you actually handle it.
          You get a grade, a laugh, and something useful.
        </p>
        <button type="button" onClick={start} className="btn-primary mt-8 w-full text-lg sm:w-auto sm:px-10">
          Let's go
        </button>
        <FooterLine />
      </QuizShell>
    );
  }

  // Question screens (step 0..4)
  if (step < 5) {
    const q = QUESTIONS[step];
    return (
      <QuizShell>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold uppercase tracking-[.14em] text-forest-soft">
            Q{step + 1} of {QUESTIONS.length}
          </span>
          <button
            type="button"
            onClick={() => {
              if (step > 0) {
                setStep(step - 1);
                setAnswers(answers.slice(0, -1));
                persist({ step: step - 1, answers: answers.slice(0, -1) });
                window.scrollTo({ top: 0, behavior: "auto" });
              }
            }}
            className={`min-h-11 text-base font-semibold text-forest underline underline-offset-4 ${step === 0 ? "invisible" : ""}`}
          >
            ← Back
          </button>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-cream-deep" aria-hidden="true">
          <div
            className="h-full rounded-full bg-forest transition-[width] duration-300 ease-out"
            style={{ width: `${((answered) / QUESTIONS.length) * 100}%` }}
          />
        </div>
        <h1 className="mt-6 font-display text-2xl font-semibold leading-snug tracking-tight text-forest sm:text-3xl">
          {q.label}
        </h1>
        <div className="mt-6 flex flex-col gap-3" role="group" aria-label={q.label}>
          {q.choices.map((c, ci) => {
            const chosen = selected === ci;
            const dimmed = selected !== null && !chosen;
            return (
              <button
                key={ci}
                type="button"
                onClick={() => pick(ci)}
                aria-pressed={chosen}
                className={`min-h-14 w-full rounded-2xl border-2 px-4 py-4 text-left text-base leading-relaxed transition-colors duration-150 select-none ${
                  chosen
                    ? "border-forest bg-forest/10 text-forest"
                    : "border-line bg-card text-ink hover:border-forest/40"
                } ${dimmed ? "opacity-60" : ""}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        <FooterLine />
      </QuizShell>
    );
  }

  // Grade screen (step 5)
  const res = computeResult(answers);
  const pct = Math.round((res.total / 20) * 100);
  return (
    <QuizShell wide>
      <LogoMark />
      <div className="bys-wizard-in card mt-6 p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Your grade</p>
        <div className="mt-2 flex items-end gap-2">
          <span className="font-display text-6xl font-semibold leading-none text-forest">{res.total}</span>
          <span className="pb-1 text-lg font-medium text-taupe">/ 20</span>
        </div>
        <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-cream-deep" aria-hidden="true">
          <div
            className="h-full rounded-full bg-forest transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <h1 className="mt-5 font-display text-3xl font-semibold leading-tight tracking-tight text-forest">
          {res.band.name}
        </h1>
        <p className="mt-2 text-base leading-relaxed text-stone sm:text-lg">{res.band.read}</p>

        <div className="mt-5 rounded-2xl bg-cream-deep p-4">
          <p className="text-sm font-semibold uppercase tracking-[.14em] text-forest-soft">Where to start</p>
          <p className="mt-1 text-base leading-relaxed text-ink">{res.band.improvement(res.dims)}</p>
        </div>

        <p className="mt-4 text-base italic leading-relaxed text-taupe">{res.joke}</p>
      </div>

      {/* Free account — the payoff (real free tier, honest). */}
      <section
        aria-label="Get your free account"
        className="bys-wizard-in mt-5 rounded-xl border border-forest/25 bg-forest p-6 text-cream sm:p-8"
      >
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-cream/75">
          Your free account is on the house — because you need it.
        </p>
        <h2 className="mt-2 font-display text-2xl font-semibold leading-tight sm:text-3xl">
          Your grade comes with something real.
        </h2>

        {capState === "saved" ? (
          <div className="mt-5">
            <p className="text-xl font-semibold">You're in.</p>
            <ul className="mt-3 space-y-2 text-base leading-relaxed text-cream/90">
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5">✓</span>
                <span>Review your messages before you send them — calm rewrites when you need them.</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5">✓</span>
                <span>A calm place to log what happened — your record, kept simple.</span>
              </li>
              <li className="flex items-start gap-2">
                <span aria-hidden="true" className="mt-0.5">✓</span>
                <span>Honest and simple — no games, cancel anytime, it stays yours.</span>
              </li>
            </ul>
            {confirmLink ? (
              <a
                href={confirmLink}
                className="btn-primary mt-5 w-full bg-cream text-forest hover:bg-cream-deep"
              >
                Continue in the app →
              </a>
            ) : (
              <p className="mt-5 text-base text-cream/85">Check your inbox to finish setting up.</p>
            )}
          </div>
        ) : (
          <>
            <p className="mt-3 text-base leading-relaxed text-cream/85">
              Free means free. No credit card. Just a calmer way to handle the next exchange.
            </p>
            <form onSubmit={submitEmail} noValidate className="mt-5 flex flex-col gap-3 sm:flex-row">
              <label htmlFor="quiz-email" className="sr-only">
                Email address
              </label>
              <input
                id="quiz-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (capState === "error") {
                    setCapState("idle");
                    setCapError("");
                    setExistingAccount(false);
                  }
                }}
                placeholder="you@email.com"
                className="min-h-12 w-full rounded-full border border-cream/30 bg-forest-soft/40 px-5 py-3 text-base text-cream placeholder:text-cream/50 focus:border-cream focus:outline-none"
              />
              <button type="submit" disabled={capState === "saving"} className="btn-primary shrink-0 bg-cream text-forest hover:bg-cream-deep">
                {capState === "saving" ? "One sec…" : "Get my free account"}
              </button>
            </form>
            {capState === "error" && (
              <div role="alert" className="mt-4 rounded-2xl bg-forest-soft/40 p-4">
                <p className="text-base leading-relaxed text-cream">{capError}</p>
                {existingAccount && (
                  <a href="/login" className="mt-2 inline-flex min-h-11 items-center text-base font-semibold text-cream underline underline-offset-4">
                    Sign in to your account →
                  </a>
                )}
              </div>
            )}
            <p className="mt-4 text-sm leading-relaxed text-cream/60">
              Your free account stays free as long as you like — no card, no surprises.
            </p>
          </>
        )}
      </section>

      <button type="button" onClick={restart} className="mt-6 min-h-11 self-center text-base text-stone underline underline-offset-4">
        Take it again
      </button>
      <FooterLine />
    </QuizShell>
  );
}

// ── Minimal standalone chrome (no site header/footer — hidden ad landing) ───

function LogoMark() {
  return (
    <img
      src="/logo-bys.svg"
      alt="Before You Send"
      className="h-9 w-auto"
      width={160}
      height={36}
    />
  );
}

function QuizShell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-dvh bg-cream text-ink">
      <main
        id="main"
        tabIndex={-1}
        className={`mx-auto flex w-full flex-col px-5 py-6 sm:px-6 ${
          wide ? "max-w-2xl" : "max-w-xl"
        } ${wide ? "sm:py-12" : "sm:py-14"}`}
      >
        {children}
      </main>
    </div>
  );
}

function FooterLine() {
  return (
    <p className="mt-8 text-center text-xs leading-relaxed text-taupe">
      Communication guidance, not legal advice.
    </p>
  );
}
