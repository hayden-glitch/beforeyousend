import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { EMAIL_RE, confirmPath, saveReview } from "~/lib/api";
import { track } from "~/lib/analytics";
import { ensureCaptureVariant, readCaptureVariant, type CaptureVariant } from "~/lib/captureVariant";
import { computeImpactScore, type ScoreLabel } from "~/lib/impactScore";
import { isLateNight } from "~/lib/tomorrowDrafts";
import { prefersReducedMotion } from "~/lib/motion";
import { claimModal, modalOpen, releaseModal } from "~/lib/trial";
import { IconChevronDown, IconClose } from "./icons";
import TomorrowLamp from "./TomorrowLamp";

// Must stay byte-identical to EXAMPLE_DRAFT in ReviewTool.tsx — the pill below
// renders only when the draft IS the untouched sample message.
const EXAMPLE_DRAFT = `Can you please stop being so unreasonable? You never let me see the kids when it suits you, and you're always making excuses. I'm tired of your games — if this keeps up, I'll have my attorney take you back to court. The kids deserve better than how you treat them, and everyone knows it.`;

// Short stable hash of a draft, used to key local feedback so re-reviewing the
// same message doesn't stack duplicate entries.
function draftHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return String(h);
}

const FEEDBACK_OPTIONS: { key: "helped" | "good" | "not"; label: string; event: "feedback_helped_calm" | "feedback_good_read" | "feedback_not_for_me" }[] = [
  { key: "helped", label: "Helped me send calmer", event: "feedback_helped_calm" },
  { key: "good", label: "Good read", event: "feedback_good_read" },
  { key: "not", label: "Not for me", event: "feedback_not_for_me" },
];

export type ResultBlock =
  | { kind: "section"; id: string; title: string }
  | { kind: "para"; id: string; text: string }
  | { kind: "item"; id: string; text: string }
  | { kind: "rewrite"; id: string; title: string }
  | { kind: "rwtext"; id: string; text: string };

type Props = {
  blocks: ResultBlock[];
  mode: "live" | "demo";
  draft: string;
  streaming: boolean;
  // Two-mode AI Co-Parent (2026-08-11): tool tells the results how to render —
  // review (score card, rewrites-to-send copy, review footer) vs analyze (NO
  // Message Impact Score — it's honestly defined for messages only; the reply
  // settles in the score-card position with no fill bar; mandatory "fair read"
  // footer). saveNoun overrides the capture-ask copy set (the analyzer's own
  // "Keep this analysis" copy; review's copy is A/B-locked and unchanged).
  tool?: "review" | "analyze";
  saveNoun?: SaveNoun;
  // Capture-moment redesign (P1/P2): example=true means the results ON SCREEN
  // are the canned sample's — the ask is then the honesty line, never a save
  // offer. captureAsk turns on the capture surface (desktop card after the
  // rewrites, mobile bottom sheet); the dashboard (/home) does not pass it and
  // keeps the legacy bottom card position byte-for-byte. hideCapture suppresses
  // EVERY capture surface — used when the visitor is already signed in (they
  // have an account; asking for their email again would be wrong).
  example?: boolean;
  captureAsk?: boolean;
  hideCapture?: boolean;
  onUseOwnMessage?: () => void;
};

const SECTION_TITLES: Record<string, string> = {
  received: "How it may be received",
  risks: "Conflict & escalation risks",
  watchout: "Watch out for",
  facts: "Facts worth preserving",
  // Situation Analyzer sections (two-mode AI Co-Parent, 2026-08-11).
  seen: "How this may be seen",
  driving: "What's likely driving them",
  next: "What to do next",
  document: "What to document",
};

const REWRITE_TITLES: Record<string, string> = {
  gentle: "Gentle",
  direct: "Direct",
  firm: "Firm but Neutral",
  reply: "A calm reply to consider",
};

// Capture-ask copy per tool (spec §4c): the review's copy is under an A/B test
// and must stay byte-identical — the analyzer gets its own saveNoun set.
export type SaveNoun = {
  askA: string;
  askB: string;
  subA: string;
  subB: string;
  button: string;
  savedHeading: string;
  savedSub: string;
  savedLine: string;
  sheetLabel: string;
};
const REVIEW_NOUN: SaveNoun = {
  askA: "Ready to keep? It'll be on your record — ready whenever you need it.",
  askB: "This review is yours to keep.",
  subA: "Enter your email — we'll save this review to your new account, and it stays yours.",
  subB: "Enter your email and this review stays on your free account.",
  button: "Keep this review",
  savedHeading: "Saved. Your review is waiting.",
  savedSub: "Your review is saved. Continue with the in-app confirmation below.",
  savedLine: "5 free reviews every month — and this one stays on your record.",
  sheetLabel: "Save your review",
};
const ANALYZE_NOUN: SaveNoun = {
  askA: "Your analysis is saved. Want it on your record — ready whenever you need it?",
  askB: "This analysis is yours to keep.",
  subA: "Enter your email — we'll save this analysis to your new account, and it stays yours.",
  subB: "Enter your email and this analysis stays on your free account.",
  button: "Keep this analysis",
  savedHeading: "Saved. Your analysis is waiting.",
  savedSub: "Your analysis is saved. Continue with the in-app confirmation below.",
  savedLine: "5 free uses every month — and this one stays on your record.",
  sheetLabel: "Save your analysis",
};

// Display-side cleanup of LLM-output quirks in a rewrite, before render:
//  - a leading markdown heading line ("### REWRITE: DIRECT", "## Gentle", …)
//  - a plain "REWRITE: <label>" header line
//  - a stray leading apostrophe-contraction ("'d like…" → "I'd like…")
// Purely cosmetic; the raw payload saved to an account is untouched.
function cleanRewrite(text: string): string {
  let t = text.replace(/^\s+/, "");
  t = t.replace(/^#{1,6}\s*[^\n]{0,60}(?:\n+|$)/, "");
  t = t.replace(/^REWRITE\s*[:—-]\s*[^\n]{0,40}(?:\n+|$)/i, "");
  t = t.replace(/^'(d|ll|m|re|ve|s)\b/i, "I'$1");
  t = t.replace(/^[\s\n]+/, "");
  return t;
}

function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy(id: string, text: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopiedId(id);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return { copiedId, copy };
}

export default function ReviewResults({ blocks, mode, draft, streaming, example = false, captureAsk = false, hideCapture = false, onUseOwnMessage, tool = "review", saveNoun }: Props) {
  const { copiedId, copy } = useCopy();
  // Analyzer vs reviewer: derived once — the whole render branches on this.
  const isAnalyze = tool === "analyze";
  const noun = saveNoun ?? (isAnalyze ? ANALYZE_NOUN : REVIEW_NOUN);
  const [feedback, setFeedback] = useState<"idle" | "helped" | "good" | "not">("idle");
  // Capture-moment state (P1.2/P3): the mobile bottom sheet is the ask; it
  // slides up ~1.7s after completion (reward first), is dismissible, and a
  // gentle one-shot nudge re-emphasizes it if no email lands within ~6s.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetDismissed, setSheetDismissed] = useState(false);
  const [emailDone, setEmailDone] = useState(false);
  const [nudged, setNudged] = useState(false);
  const captureViewFired = useRef(false);
  // P2 11pm Lamp state: the parent's copy of the lamp's ask lifecycle, used to
  // gate lamp_shown (once per completion) and to re-arm on a new stream. The
  // TomorrowLamp component owns its own display states (idle → saved → hidden).
  const [lampState, setLampState] = useState<"idle" | "saved" | "hidden">("idle");
  const lampShownFired = useRef(false);
  // Wizard A — sequenced results reveal (Design A, "Paste → Payoff"). On the
  // streaming→done flip the payoff lands in one calm moment instead of a dump:
  //   Step 1 — the Message Impact Score card settles in first; its fill bar
  //            transitions from 0 to the DETERMINISTIC score and ends EXACTLY
  //            there (a fixed-value CSS transition never overshoots — it is
  //            monotonic to the target and stops at it).
  //   Step 2 — the three rewrite cards settle one after another (~120ms apart).
  //   Step 3 — the analysis sections unfold; the FIRST one auto-opens, the
  //            rest stay closed but tappable.
  // All motion is transform/opacity (the rewrite/analysis settle is
  // transform-only so streamed content is never flashed or re-mounted). The
  // reveal triggers on the status flip ONLY — never per NDJSON chunk — and the
  // prefers-reduced-motion path skips the timers entirely (instant, calm).
  // Saved reviews opened from history mount with streaming=false and render
  // instantly — no ceremony for a document the dad already has.
  const [seq, setSeq] = useState<{ rw: number; analysis: number }>({ rw: 0, analysis: 0 });
  // null = "show the real score at full width, no animation" (saved reviews,
  // reduced motion); the sequence path sets 0 first so the fill visibly runs
  // 0 → score exactly once, ending precisely at the real value.
  const [fillPct, setFillPct] = useState<number | null>(null);
  const seqPlayedRef = useRef(false);
  const prevStreamingRef = useRef(false);
  const seqTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Latency UX (conversion-cycle-1, 2026-08-13): if a stream is still silent
  // ~12s in (slow provider windows hit 20–45s+), show one calm line next to
  // the streaming pill — an expectation reset, never urgency. Cleared the
  // moment the first content block lands or the stream ends.
  const [stalled, setStalled] = useState(false);
  const stalledTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (streaming) {
      setStalled(false);
      if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
      stalledTimerRef.current = setTimeout(() => setStalled(true), 12000);
      return () => {
        if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
        stalledTimerRef.current = null;
      };
    }
    setStalled(false);
    if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
    stalledTimerRef.current = null;
  }, [streaming]);
  useEffect(() => {
    if (blocks.length === 0) return;
    setStalled(false);
    if (stalledTimerRef.current) clearTimeout(stalledTimerRef.current);
    stalledTimerRef.current = null;
  }, [blocks.length]);
  // First analysis section auto-opens via the NATIVE details API (one-shot,
  // never a controlled `open` prop) so React never slams a section shut that
  // the dad opened himself during streaming.
  const firstDetailsRef = useRef<HTMLDetailsElement | null>(null);

  // A completed live review (done, not example) — the moment the capture
  // surface should engage.
  const done = !streaming && !example && captureAsk && !hideCapture && blocks.length > 0 && mode === "live";

  // P1.2: arm the sheet 1.7s after completion so the reward lands first.
  // Skipped when another bottom modal (Check-In sheet etc.) is already up —
  // one ask at a time, calm.
  useEffect(() => {
    if (!done || sheetOpen || sheetDismissed || emailDone) return;
    if (typeof document !== "undefined" && document.querySelector(".bys-sheet")) return;
    const t = setTimeout(() => {
      // Shared modal lock (R6 QA P1, r6-6): the guided funnel fires ~1.4s after
      // a review completes — before this 1.7s sheet — and claims the lock, so
      // when this timer runs the lock is normally held. Yield for THIS
      // completion: the funnel's ending ("Continue free" → account) is the ask,
      // and stacking a second dialog would break the one-dialog invariant. A
      // fresh review re-arms the sheet (streaming resets sheetDismissed).
      if (modalOpen()) {
        setSheetDismissed(true);
        return;
      }
      setSheetOpen(true);
      window.dispatchEvent(new CustomEvent("bys:capture-ask-open"));
    }, 1700);
    return () => clearTimeout(t);
  }, [done, sheetOpen, sheetDismissed, emailDone]);

  // Shared modal lock (R6 QA P1): while the sheet is up it claims the same
  // window-level lock TrialModal/SpecialOffer/GuidedFunnel use, so no other
  // dialog can stack on it — and releases on close (dismiss/stream re-arm)
  // and unmount. One dialog in the DOM at a time, always.
  useEffect(() => {
    if (!sheetOpen) return;
    claimModal();
    return () => releaseModal();
  }, [sheetOpen]);

  // A new review stream re-arms the sheet (dismissal is per completion);
  // a converted email stays done for the whole page session. The 11pm lamp
  // re-arms the same way — each completion is a fresh moment, not a nag.
  useEffect(() => {
    if (streaming) {
      setSheetOpen(false);
      setSheetDismissed(false);
      setNudged(false);
      captureViewFired.current = false;
      setLampState("idle");
      lampShownFired.current = false;
    }
  }, [streaming]);

  // P3: no email within ~6s → gentle one-shot attention cue on the surface
  // that is actually visible (sheet on mobile, in-flow card on desktop).
  // No modal, no urgency, no copy change — just a calm settle.
  useEffect(() => {
    if (!done || emailDone || nudged) return;
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches && !sheetOpen) return;
    const t = setTimeout(() => setNudged(true), 6000);
    return () => clearTimeout(t);
  }, [done, emailDone, nudged, sheetOpen]);

  // P4.3: fire capture_card_view when the capture element actually enters the
  // viewport (IntersectionObserver) so the A/B reads exposure, not just
  // submission. Only one surface exists per breakpoint (card on md+, sheet on
  // mobile), so this never double-fires per completion.
  useEffect(() => {
    if (!captureAsk || example || streaming || emailDone) return;
    if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>("#bys-capture-card, #bys-capture-sheet"));
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (captureViewFired.current) return;
        if (entries.some((e) => e.isIntersecting)) {
          captureViewFired.current = true;
          track("capture_card_view", { variant: readCaptureVariant() ?? undefined });
        }
      },
      { threshold: 0.3 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [captureAsk, example, streaming, emailDone, sheetOpen]);

  const dismissSheet = () => {
    setSheetOpen(false);
    setSheetDismissed(true);
    window.dispatchEvent(new CustomEvent("bys:capture-ask-closed"));
  };

  function sendFeedback(option: (typeof FEEDBACK_OPTIONS)[number]) {
    if (feedback !== "idle") return;
    track(option.event, {});
    try {
      const key = "bys_feedback";
      const arr = JSON.parse(localStorage.getItem(key) || "[]") as unknown[];
      arr.push({ hash: draftHash(draft), sentiment: option.key, ts: Date.now() });
      localStorage.setItem(key, JSON.stringify(arr));
    } catch {
      /* storage unavailable — the analytics event still fired */
    }
    setFeedback(option.key);
  }

  const sections = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, { title: string; paras: string[]; items: string[] }>();
    const rewrites: { id: string; title: string; text: string }[] = [];

    for (const b of blocks) {
      if (b.kind === "section") {
        if (!map.has(b.id)) {
          order.push(b.id);
          map.set(b.id, { title: b.title, paras: [], items: [] });
        }
      } else if (b.kind === "para") {
        const s = map.get(b.id) ?? { title: "", paras: [], items: [] };
        s.paras.push(b.text);
        map.set(b.id, s);
        if (!order.includes(b.id)) order.push(b.id);
      } else if (b.kind === "item") {
        const s = map.get(b.id) ?? { title: "", paras: [], items: [] };
        s.items.push(b.text);
        map.set(b.id, s);
        if (!order.includes(b.id)) order.push(b.id);
      } else if (b.kind === "rewrite") {
        rewrites.push({ id: b.id, title: b.title, text: "" });
      } else if (b.kind === "rwtext") {
        const r = rewrites.find((x) => x.id === b.id);
        if (r) r.text += (r.text ? "\n" : "") + b.text;
      }
    }
    const finalRewrites = rewrites.map((r) => ({
      ...r,
      title: REWRITE_TITLES[r.id] ?? r.title,
      text: cleanRewrite(r.text),
    }));
    return { order, map, rewrites: finalRewrites };
  }, [blocks]);

  // Message Impact Score (calm-loop slice 1): deterministic, from the review's
  // own structured flags only — the card renders right after the rewrites
  // (reward first), before any ask. Real + example reviews, never demo mode.
  const impact = useMemo(() => (blocks.length > 0 ? computeImpactScore(blocks) : null), [blocks]);
  // NO Message Impact Score for the analyzer (ratified 2026-08-11): the score
  // is honestly defined for messages only — never invent one for a situation.
  const scoreVisible = !isAnalyze && blocks.length > 0 && !streaming && mode === "live" && impact !== null;
  // Wizard A reveal effect: arms on streaming→done, never per chunk (deps =
  // [streaming] only; blocks re-render each NDJSON chunk but this stays quiet
  // until the status actually flips). A new stream disarms and resets so every
  // completion plays the sequence exactly once.
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = streaming;
    if (streaming) {
      seqPlayedRef.current = false;
      seqTimersRef.current.forEach(clearTimeout);
      seqTimersRef.current = [];
      setSeq({ rw: 0, analysis: 0 });
      setFillPct(null);
      return;
    }
    // Non-streamed completion (a saved review opened from history, or a fresh
    // mount that already has blocks): instant, no ceremony.
    if (!wasStreaming || seqPlayedRef.current || blocks.length === 0) return;
    seqPlayedRef.current = true;
    if (isAnalyze) {
      // Analyzer ceremony (spec §2.2): NO score card, no fill bar. The reply
      // card ("A calm reply to consider") settles FIRST at t=0 — the payoff in
      // the score-card position — then the four sections unfold ~120ms apart
      // (130/250/370/490), the first auto-opening via the native details API.
      // All <650ms; transform-only; reduced-motion instant (below).
      if (prefersReducedMotion()) {
        setSeq({ rw: 1, analysis: sections.order.length });
        requestAnimationFrame(() => {
          if (firstDetailsRef.current) firstDetailsRef.current.open = true;
        });
        return;
      }
      setSeq({ rw: 1, analysis: 0 });
      const pushA = (fn: () => void, ms: number) => {
        seqTimersRef.current.push(setTimeout(fn, ms));
      };
      pushA(() => {
        setSeq((s) => ({ ...s, analysis: Math.max(1, s.analysis) }));
        if (firstDetailsRef.current) firstDetailsRef.current.open = true;
      }, 130);
      pushA(() => setSeq((s) => ({ ...s, analysis: Math.max(2, s.analysis) })), 250);
      pushA(() => setSeq((s) => ({ ...s, analysis: Math.max(3, s.analysis) })), 370);
      pushA(() => setSeq((s) => ({ ...s, analysis: Math.max(4, s.analysis) })), 490);
      return () => {
        seqTimersRef.current.forEach(clearTimeout);
        seqTimersRef.current = [];
      };
    }
    const target = impact?.score ?? 0;
    if (prefersReducedMotion()) {
      // Instant calm state under reduce: everything full, no timers at all.
      setSeq({ rw: 3, analysis: sections.order.length });
      setFillPct(target);
      requestAnimationFrame(() => {
        if (firstDetailsRef.current) firstDetailsRef.current.open = true;
      });
      return;
    }
    // Full sequence, total ~650ms of appearances (fills/settles end <1s):
    // Step 1 t=0      score card mounts (bys-wizard-in) + fill starts 0→score
    // Step 2 t≈130–370 the three rewrite cards settle ~120ms apart
    // Step 3 t≈440–650 the analysis sections unfold; first auto-opens
    setFillPct(0);
    const push = (fn: () => void, ms: number) => {
      seqTimersRef.current.push(setTimeout(fn, ms));
    };
    push(() => setFillPct(target), 30); // one frame later so the width transition 0→score actually plays
    push(() => setSeq((s) => ({ ...s, rw: 1 })), 130);
    push(() => setSeq((s) => ({ ...s, rw: 2 })), 250);
    push(() => setSeq((s) => ({ ...s, rw: 3 })), 370);
    push(() => {
      setSeq((s) => ({ ...s, analysis: Math.max(1, s.analysis) }));
      if (firstDetailsRef.current) firstDetailsRef.current.open = true;
    }, 440);
    push(() => setSeq((s) => ({ ...s, analysis: Math.max(2, s.analysis) })), 510);
    push(() => setSeq((s) => ({ ...s, analysis: Math.max(3, s.analysis) })), 580);
    push(() => setSeq((s) => ({ ...s, analysis: Math.max(4, s.analysis) })), 650);
    return () => {
      seqTimersRef.current.forEach(clearTimeout);
      seqTimersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);
  // P2 11pm Lamp gate: only when it is genuinely late (10pm–5am local) AND the
  // deterministic score already reads heated — the card restates facts he saw,
  // it never invents urgency. ?lamp=1 is a QA-only forcing flag (agent-browser
  // can't change the system clock); it is never shown in the UI. The lamp
  // defers while the mobile capture sheet is up (one ask at a time).
  const LAMP_QA_OVERRIDE = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("lamp") === "1";
  const lampVisible =
    scoreVisible && impact !== null && !example && captureAsk && !sheetOpen &&
    (impact.label === "Heated" || impact.label === "High conflict signals") &&
    (LAMP_QA_OVERRIDE || isLateNight(new Date()));
  // lamp_shown fires once per completion (ref-guarded, like captureViewFired).
  useEffect(() => {
    if (lampVisible && lampState === "idle" && !lampShownFired.current && impact) {
      lampShownFired.current = true;
      track("lamp_shown", { score: impact.score, label: impact.label });
    }
  }, [lampVisible, lampState, impact]);
  const SCORE_BAR: Record<ScoreLabel, string> = {
    Calm: "bg-forest",
    "Fairly calm": "bg-forest-soft",
    Heated: "bg-amber-500",
    "High conflict signals": "bg-red-900/70",
  };
  const SCORE_CHIP: Record<ScoreLabel, string> = {
    Calm: "bg-forest/10 text-forest",
    "Fairly calm": "bg-forest/10 text-forest",
    Heated: "bg-amber-500/15 text-amber-700",
    "High conflict signals": "bg-red-900/10 text-red-900",
  };


  return (
    <div className="mt-8 space-y-6">
      {mode === "demo" && (
        <p className="rounded-2xl border-2 border-amber-500 bg-amber-50 px-4 py-3 text-base font-semibold text-amber-900">
          SAMPLE — this is canned demo output, NOT a live {isAnalyze ? "analysis" : "review"} of your {isAnalyze ? "situation" : "message"}.
          It is only shown when the server runs without a live AI key (dev setups).
          It cannot be saved to an account.
        </p>
      )}

      {draft === EXAMPLE_DRAFT && (
        <p className="rounded-2xl border border-forest/20 bg-forest/5 px-4 py-3 text-base font-medium text-forest">
          Example review — this is a sample message, not your draft.
        </p>
      )}

      {/* Rewrites — the payoff, FIRST so they dominate the first viewport.
          In the analyzer this is the single "A calm reply to consider" card:
          no heading (the card carries its own title) and a fixed honesty line. */}
      {sections.rewrites.length > 0 && (
        <div>
          {!isAnalyze && (
            <h3 className="text-lg font-semibold tracking-tight text-forest">
              Rewrites to send
            </h3>
          )}
          <div className={isAnalyze ? "" : "mt-4 space-y-4"}>
            {sections.rewrites.map((r, ri) => (
              <div
                key={r.id}
                className={`rounded-3xl border border-line bg-card p-6 shadow-card${ri < seq.rw ? " bys-wizard-settle" : ""}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex rounded-full bg-cream-deep px-3 py-1 text-base font-semibold text-forest">
                    {r.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(`rw-${r.id}`, r.text)}
                    className={`btn-copy ${copiedId === `rw-${r.id}` ? "btn-copy--done" : ""}`}
                    aria-label={isAnalyze ? "Copy suggested reply" : `Copy ${r.title} rewrite`}
                  >
                    {copiedId === `rw-${r.id}` ? (
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path
                            d="M5 13l4 4L19 7"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Copied
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <rect
                            x="9"
                            y="9"
                            width="11"
                            height="11"
                            rx="2"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                          <path
                            d="M5 15V6a2 2 0 0 1 2-2h9"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                          />
                        </svg>
                        Copy
                      </span>
                    )}
                  </button>
                </div>
                <p
                  className={`mt-3 whitespace-pre-line text-base leading-relaxed text-ink ${
                    streaming && r === sections.rewrites[sections.rewrites.length - 1]
                      ? "stream-caret"
                      : ""
                  }`}
                >
                  {r.text}
                </p>
                {isAnalyze && (
                  <p className="mt-3 text-sm text-stone">A starting point — not a script.</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Message Impact Score — right after the rewrites (reward first), before
          the capture ask. Honest, deterministic, from this review's own flags.
          The footer line is mandatory on every render — never remove it. */}
      {scoreVisible && impact && (
        <div className="bys-wizard-in rounded-3xl border border-line bg-card p-5 shadow-card">
          <div className="flex items-start justify-between gap-3">
            <p className="text-lg font-semibold tracking-tight text-forest">How this message reads</p>
            <div className="shrink-0 text-right">
              <span className="text-2xl font-semibold leading-none text-forest">{impact.score}</span>
              <span className={`ml-2 inline-flex translate-y-[-2px] rounded-full px-2.5 py-1 text-sm font-semibold ${SCORE_CHIP[impact.label]}`}>
                {impact.label}
              </span>
            </div>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-cream-deep">
            <div
              className={`h-2 rounded-full transition-[width] duration-[420ms] ease-out ${SCORE_BAR[impact.label]}`}
              style={{ width: `${fillPct === null ? impact.score : fillPct}%` }}
              role="img"
              aria-label={`${impact.score} out of 100`}
            />
          </div>
          <p className="mt-3 text-base text-stone">
            {impact.flags.movedBy.join(" · ")}
          </p>
          <p className="mt-2 text-sm text-stone">Tone and conflict signals only — not a prediction.</p>
        </div>
      )}
      {/* P2 11pm Lamp — right after the score card, BEFORE the capture ask:
          the brand promise ("The message you wrote at 11pm doesn't have to be
          the one you send") made real at the exact moment it matters. The
          component owns idle → saved → hidden; the parent gate defers it
          behind the capture sheet (one ask at a time). */}
      {lampVisible && lampState !== "hidden" && impact && (
        <div className="mt-4">
          <TomorrowLamp draft={draft} score={impact.score} label={impact.label} />
        </div>
      )}
      {/* Capture ask — directly after the rewrites, BEFORE the collapsible
          analysis sections (capture-moment redesign): the ask lands in the
          first post-completion viewport. Desktop (md+) shows the in-flow card;
          on mobile the card is hidden — the bottom sheet IS the ask. For
          example reviews the ask is the honesty line: never a save offer. */}
      {!streaming && mode === "live" && captureAsk && !example && !hideCapture && (
        <div id="bys-capture-card" className={`hidden md:block ${nudged ? "bys-capture-nudge" : ""}`}>
          <EmailCapture draft={draft} reviewText={fullText(blocks)} noun={noun} onSubmitted={() => setEmailDone(true)} />
        </div>
      )}
      {!streaming && example && (
        <ExampleAsk onUseOwnMessage={onUseOwnMessage} />
      )}

      {/* Analysis sections — collapsible so the rewrites stay front and center.
          Wizard A step 3: on completion the FIRST section auto-opens (native
          details API — never a controlled prop), the rest stay closed but
          tappable; each gets a gentle transform-only settle. */}
      {sections.order.map((id, ai) => {
        const s = sections.map.get(id)!;
        const title = s.title || SECTION_TITLES[id] || id;
        return (
          <details
            key={id}
            ref={ai === 0 ? firstDetailsRef : undefined}
            className={`group rounded-3xl border border-line bg-card shadow-card${ai < seq.analysis ? " bys-wizard-settle" : ""}`}
          >
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-lg font-semibold tracking-tight text-forest [&::-webkit-details-marker]:hidden">
              <span>{title}</span>
              <span aria-hidden="true" className="shrink-0">
                <IconChevronDown className="h-5 w-5 text-forest-soft transition-transform duration-200 group-open:rotate-180" />
              </span>
            </summary>
            <div className="px-6 pb-6">
              {s.paras.length > 0 && (
                <p className="text-base leading-relaxed text-ink">
                  {s.paras.join("\n\n")}
                </p>
              )}
              {s.items.length > 0 && (
                <ul className={s.paras.length > 0 ? "mt-3 space-y-2.5" : "space-y-2.5"}>
                  {s.items.map((item, i) => (
                    <li key={i} className="flex gap-3 text-base leading-relaxed text-ink">
                      <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-forest-soft" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        );
      })}

      <p className="text-base text-stone">
        {isAnalyze
          ? "A fair read of the situation — not a prediction, and not legal advice."
          : "An honest read — not legal advice."}
      </p>

      {streaming ? (
        <>
          <p className="rounded-2xl border border-line bg-cream-deep px-4 py-3 text-base text-stone">{isAnalyze ? "Reading the situation — how it may look, and what to do next…" : "Reading the tone, conflict risks, and calmer rewrites…"}</p>
          {stalled && (
            <p className="rounded-2xl border border-forest/15 bg-card px-4 py-3 text-base text-stone">
              Still working — this can take up to a minute when things are slow. Nothing's lost.
            </p>
          )}
        </>
      ) : mode === "demo" ? (
        <p className="rounded-2xl border border-line bg-cream-deep px-4 py-3 text-base text-stone">
          {isAnalyze ? "Sample output is never saved to an account. Describe a real situation and get a live analysis." : "Sample output is never saved to an account. Paste a real draft and get a live AI review."}
        </p>
      ) : !captureAsk && !hideCapture ? (
        /* Legacy position (dashboard /home): the card stays at the bottom. */
        <EmailCapture draft={draft} reviewText={fullText(blocks)} noun={noun} onSubmitted={() => setEmailDone(true)} />
      ) : null}

      {!streaming && mode === "live" && !example && (
        <div className="rounded-3xl border border-line bg-cream-deep/50 p-5">
          <p className="text-base font-semibold text-forest">{isAnalyze ? "Did this help?" : "Did this review help?"}</p>
          {feedback === "idle" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {FEEDBACK_OPTIONS.map((o) => (
                <button key={o.key} type="button" onClick={() => sendFeedback(o)} className="chip">
                  {o.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-base text-stone">Thanks — that helps us build better reviews.</p>
          )}
        </div>
      )}

      {/* Mobile capture sheet — the ask, bottom-sticky, dismissible. Slides up
          1.7s after completion (reward lands first). Same variant A/B copy +
          one email field + "Keep this review" + X. Hidden on md+ (the in-flow
          card is the ask there). */}
      {sheetOpen && captureAsk && !example && !hideCapture && (
        <CaptureSheet
          draft={draft}
          reviewText={fullText(blocks)}
          nudge={nudged}
          noun={noun}
          onDismiss={dismissSheet}
          onSubmitted={() => setEmailDone(true)}
        />
      )}
    </div>
  );
}

// Full review text for the landing email-capture save (POST /api/save). Stream
// order is preserved; section titles and rewrite labels are emitted as "### "
// headers so NEW saved payloads are self-describing when opened from the
// dashboard (old headerless rows still render fine — home.tsx shows them as
// pre-wrap text). Rewrite bodies go through cleanRewrite so a stray LLM heading
// never lands in the saved text.
function fullText(blocks: ResultBlock[]): string {
  const lines: string[] = [];
  let pending: { title: string; text: string } | null = null;
  const flush = () => {
    if (!pending) return;
    lines.push("### " + pending.title);
    lines.push(cleanRewrite(pending.text));
    pending = null;
  };
  for (const b of blocks) {
    if (b.kind === "section") {
      flush();
      lines.push("### " + (SECTION_TITLES[b.id] ?? (b.title || b.id)));
    } else if (b.kind === "para" || b.kind === "item") {
      flush();
      lines.push(b.text);
    } else if (b.kind === "rewrite") {
      flush();
      pending = { title: REWRITE_TITLES[b.id] ?? (b.title || b.id), text: "" };
    } else if (b.kind === "rwtext") {
      if (pending) pending.text += (pending.text ? "\n" : "") + b.text;
      else lines.push(b.text);
    }
  }
  flush();
  return lines.join("\n").slice(0, 12000);
}

// Shared email-capture submit logic for the in-flow card and the mobile sheet:
// validation → saveReview (draft + full review text) → confirm link + variant
// on email_submitted. Both surfaces fire the exact same funnel events.
// onSaved fires once on a successful save (parent stops nudge/sheet timers).
function useCaptureSubmit(draft: string, reviewText: string, variant: CaptureVariant, onSaved?: () => void) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [confirmLink, setConfirmLink] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setState("error");
      setError("Enter your email so we can save the review.");
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setState("error");
      setError("That email doesn't look right — double-check it.");
      return;
    }
    setState("saving");
    setError("");
    const res = await saveReview(value, draft, reviewText);
    if (res.ok) {
      setConfirmLink(confirmPath(res.token, res.link));
      setState("saved");
      // meta.variant is what makes the funnel readable per arm: persistEvent
      // maps email_submitted → email_captured and keeps meta as-is, so the
      // owner dashboard's per-visitor timeline shows variant a|b on the event.
      track("email_submitted", { variant });
      onSaved?.();
    } else {
      setState("error");
      setError(res.message);
    }
  }
  return { email, setEmail, state, setState, error, setError, confirmLink, submit };
}

function EmailCapture({ draft, reviewText, noun = REVIEW_NOUN, onSubmitted }: { draft: string; reviewText: string; noun?: SaveNoun; onSubmitted?: () => void }) {
  // Capture-card A/B (conversion-plan-next-cycle.md §3): 50/50 arm assignment
  // happens HERE, at results render — the cookie is set once and persists a
  // year (see ~/lib/captureVariant). The assigned arm rides along on the
  // email_submitted → email_captured funnel event as meta.variant.
  const [variant] = useState<CaptureVariant>(() => ensureCaptureVariant());
  const { email, setEmail, state, setState, error, setError, confirmLink, submit: onSubmit } = useCaptureSubmit(draft, reviewText, variant, onSubmitted);
  if (state === "saved") {
    return (
      <div className="rounded-3xl border border-forest/25 bg-forest p-6 text-cream">
        <p className="text-lg font-semibold">{noun.savedHeading}</p>
        <p className="mt-2 text-base text-cream/85">
          {noun.savedSub}
        </p>
        {confirmLink ? <a href={confirmLink} className="mt-4 inline-flex min-h-11 items-center font-semibold text-cream underline underline-offset-4">Continue in the app →</a> : <a href="/login" className="mt-4 inline-flex min-h-11 items-center font-semibold text-cream underline underline-offset-4">Continue to sign in →</a>}
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-3xl border border-line bg-card p-6 shadow-card"
      noValidate
    >
      {variant === "b" ? (
        <>
          <h3 className="text-xl font-semibold leading-snug tracking-tight text-forest">{noun.askB}</h3>
          <p className="mt-1 text-base text-stone">
            {noun.subB}
          </p>
        </>
      ) : (
        <>
          <h3 className="text-xl font-semibold leading-snug tracking-tight text-forest">{noun.askA}</h3>
          <p className="mt-1 text-base text-stone">
            {noun.subA}
          </p>
        </>
      )}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (state === "error") {
              setState("idle");
              setError("");
            }
          }}
          className="min-h-12 w-full rounded-full border border-line bg-cream px-5 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
          required
        />
        <button
          type="submit"
          disabled={state === "saving"}
          className="btn-primary shrink-0"
        >
          {state === "saving" ? "Saving…" : noun.button}
        </button>
      </div>
      <p className="mt-3 text-sm text-stone">
        {variant === "b"
          ? "No card. No spam. Cancel anytime. Your draft stays private."
          : "No card. No spam. Cancel anytime. We never sell your data."}
      </p>
      <p className="mt-2 text-sm text-stone">{noun.savedLine}</p>
      {state === "error" && error && (
        <p role="alert" className="mt-3 text-base text-red-800">
          {error}
        </p>
      )}
    </form>
  );
}

// Mobile sticky bottom sheet — the capture ask. Same variant A/B copy lines,
// one email field + "Keep this review" + an X to dismiss. Pattern reused from
// CoParentCheckIn's sheet (bys-sheet slide-in, grabber, safe-area padding),
// but WITHOUT a full-screen backdrop: it's a sticky ask, not a modal.
function CaptureSheet({ draft, reviewText, nudge, noun = REVIEW_NOUN, onDismiss, onSubmitted }: { draft: string; reviewText: string; nudge: boolean; noun?: SaveNoun; onDismiss: () => void; onSubmitted: () => void }) {
  const [variant] = useState<CaptureVariant>(() => ensureCaptureVariant());
  const { email, setEmail, state, setState, error, setError, confirmLink, submit } = useCaptureSubmit(draft, reviewText, variant, onSubmitted);

  if (state === "saved") {
    return (
      <div id="bys-capture-sheet" className="fixed inset-x-0 bottom-0 z-[36] md:hidden" role="dialog" aria-label={noun.savedHeading}>
        <div className="bys-sheet mx-auto w-full max-w-3xl rounded-t-[2rem] border-t-2 border-forest bg-card px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-2xl">
          <div className="bys-grabber" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-forest">{noun.savedHeading}</h3>
              <p className="mt-1 text-base text-stone">{noun.savedSub}</p>
            </div>
            <button type="button" onClick={onDismiss} className="icon-btn min-h-11 shrink-0 text-stone" aria-label="Dismiss">
              <IconClose className="h-5 w-5" />
            </button>
          </div>
          {confirmLink ? <a href={confirmLink} className="mt-3 inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4">Continue in the app →</a> : <a href="/login" className="mt-3 inline-flex min-h-11 items-center font-semibold text-forest underline underline-offset-4">Continue to sign in →</a>}
        </div>
      </div>
    );
  }

  return (
    <div id="bys-capture-sheet" className="fixed inset-x-0 bottom-0 z-[36] md:hidden" role="dialog" aria-label={noun.sheetLabel}>
      <div className={`bys-sheet mx-auto w-full max-w-3xl rounded-t-[2rem] border-t-2 border-forest bg-card px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-2xl ${nudge ? "bys-capture-nudge" : ""}`}>
        <div className="bys-grabber" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {variant === "b" ? (
              <>
                <h3 className="text-lg font-semibold leading-snug tracking-tight text-forest">{noun.askB}</h3>
                <p className="mt-1 text-base text-stone">{noun.subB}</p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold leading-snug tracking-tight text-forest">{noun.askA}</h3>
                <p className="mt-1 text-base text-stone">{noun.subA}</p>
              </>
            )}
          </div>
          <button type="button" onClick={onDismiss} className="icon-btn min-h-11 shrink-0 text-stone" aria-label="Dismiss">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="mt-4" noValidate>
          <label htmlFor="capture-sheet-email" className="sr-only">Email address</label>
          <input
            id="capture-sheet-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "error") {
                setState("idle");
                setError("");
              }
            }}
            className="min-h-12 w-full rounded-full border border-line bg-cream px-5 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
            required
          />
          <button type="submit" disabled={state === "saving"} className="btn-primary mt-3 w-full">
            {state === "saving" ? "Saving…" : noun.button}
          </button>
        </form>
        <p className="mt-3 text-sm text-stone">
          {variant === "b"
            ? "No card. No spam. Cancel anytime. Your draft stays private."
            : "No card. No spam. Cancel anytime. We never sell your data."}
        </p>
        <p className="mt-2 text-sm text-stone">{noun.savedLine}</p>
        {state === "error" && error && (
          <p role="alert" className="mt-3 text-base text-red-800">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

// P2.1 honesty ask: example reviews are NEVER saveable — the ask hands the
// box back to the dad so his own (real) review can run free.
function ExampleAsk({ onUseOwnMessage }: { onUseOwnMessage?: () => void }) {
  return (
    <div className="rounded-3xl border-2 border-forest/25 bg-forest/5 p-6">
      <p className="text-lg font-semibold leading-snug tracking-tight text-forest">
        That's the shape of it. Paste YOUR message — your first review is free, no account.
      </p>
      {onUseOwnMessage && (
        <button type="button" onClick={onUseOwnMessage} className="btn-primary mt-4 w-full">
          Paste my message
        </button>
      )}
    </div>
  );
}
