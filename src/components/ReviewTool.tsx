import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { streamReview, streamAnalyze, type ReviewEvent, type Attachment, EMAIL_RE, confirmPath, saveReview } from "~/lib/api";
import { track, trackFunnelOnce } from "~/lib/analytics";
import { readCaptureVariant } from "~/lib/captureVariant";
import { markValueDelivered } from "~/lib/offer";
import { useReviewTyping } from "~/lib/useReviewTyping";
import ReviewResults, { type ResultBlock } from "~/components/ReviewResults";
import TomorrowDraftsList from "~/components/TomorrowDraftsList";
import ModeSwitch, { type ToolMode } from "~/components/ModeSwitch";
import AttachControl, { AttachChips } from "~/components/AttachControl";
import { scrollBehavior } from "~/lib/motion";

const EXAMPLE_DRAFT = `Can you please stop being so unreasonable? You never let me see the kids when it suits you, and you're always making excuses. I'm tired of your games — if this keeps up, I'll have my attorney take you back to court. The kids deserve better than how you treat them, and everyone knows it.`;

// Situation-analyzer prompt chips (spec §2.1): one quiet row, gentle prompts
// (NOT fields). Tapping appends the label line into the textarea + refocuses.
// The row auto-hides once the dad has typed more than 120 characters.
const PROMPT_CHIPS: { label: string; prefix: string }[] = [
  { label: "What happened", prefix: "What happened: " },
  { label: "What they said or did", prefix: "What they said or did: " },
  { label: "What you want next", prefix: "What you want next: " },
];

type Props = {
  reviewRef: RefObject<HTMLElement | null>;
};

type Status = "idle" | "streaming" | "done" | "error";
interface ModeState {
  draft: string;
  blocks: ResultBlock[];
  status: Status;
  error: string;
  quota: boolean;
}
const IDLE: ModeState = { draft: "", blocks: [], status: "idle", error: "", quota: false };

function initialTool(): ToolMode {
  if (typeof window === "undefined") return "review";
  return new URLSearchParams(window.location.search).get("mode") === "analyze" ? "analyze" : "review";
}

export default function ReviewTool({ reviewRef }: Props) {
  // Two-mode AI Co-Parent (owner 2026-08-11): per-mode state, so switching
  // away and back preserves the draft AND finished results exactly. Results
  // render only for the active mode; switching mid-stream aborts the active
  // stream (server refunds the slot — api.ts abort path) with no error toast.
  const [tool, setTool] = useState<ToolMode>(initialTool);
  const [reviewState, setReviewState] = useState<ModeState>(IDLE);
  const [analyzeState, setAnalyzeState] = useState<ModeState>(IDLE);
  const st = tool === "review" ? reviewState : analyzeState;
  const [mode, setMode] = useState<"live" | "demo">("live");
  const abortRef = useRef<AbortController | null>(null);
  // The stream's owning mode, captured at run start — NDJSON events patch that
  // mode's state even if the user switched the pill mid-flight (switch aborts
  // the stream first, so in practice events only arrive for the active mode).
  const streamModeRef = useRef<ToolMode>("review");
  const toolRef = useRef<ToolMode>(tool);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  const patch = useCallback((m: ToolMode, p: Partial<ModeState> | ((s: ModeState) => Partial<ModeState>)) => {
    const upd = typeof p === "function" ? p : () => p;
    if (m === "review") setReviewState((s) => ({ ...s, ...upd(s) }));
    else setAnalyzeState((s) => ({ ...s, ...upd(s) }));
  }, []);
  // Capture-moment redesign (P1): the results wrapper — auto-scrolled into the
  // first post-completion viewport so the payoff (rewrites) and the ask land
  // without a manual scroll. scroll-mt-24 clears the sticky header.
  const resultsWrapRef = useRef<HTMLDivElement>(null);
  // P2.3: the user's own draft/results must survive the "See a real example"
  // tap — stash them here and swap them back when the example run finishes.
  const exampleBackupRef = useRef<{ draft: string; blocks: ResultBlock[] } | null>(null);
  // P4.2: example flag rides on review_completed meta (ref so the stable
  // done-handler can read the run type of the stream that just finished).
  const exampleRunRef = useRef(false);
  // True while the results ON SCREEN are the canned example's (drives the
  // honesty capture ask — never a save offer for a fake review).
  const [exampleResults, setExampleResults] = useState(false);
  // Hard double-submit guard: React state can't block two submits in the same
  // tick (rapid click / Enter+click), so gate on a ref that flips synchronously.
  const submittingRef = useRef(false);
  // FIX 2 (polish r1, QA 99d7894e): true once a REAL (non-example) review or
  // analysis has succeeded this session. The 402 quota copy is only honest
  // after genuine use — a dad whose every attempt failed must never be told
  // "You've used your free review for today."
  const hadSuccessRef = useRef(false);
  // Typing telemetry for the owner's live dashboard (started once per mount,
  // throttled heartbeat while typing; see useReviewTyping).
  const { onActivity: onTyping, clear: clearTyping } = useReviewTyping();
  // Signed-in visitor on the landing page (they came back via the logo or a
  // bookmark): they already have an account, so the email-capture ask must not
  // appear after their review. Checked once on mount, non-blocking — a review
  // takes ~15s, so auth has resolved long before the capture moment.
  // Attachments (Steady+): the effective tier (user.quota.tier — gift-month
  // recipients included) decides paperclip vs ghost chip on the landing page.
  const [authed, setAuthed] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { credentials: "include" })
      .then(async (r) => {
        if (!alive || !r.ok) return;
        setAuthed(true);
        try {
          const j = await r.json();
          const t = j?.quota?.tier || j?.user?.profile?.tier;
          if (typeof t === "string") setTier(t);
        } catch {}
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  // Attachments are composer state (shared across modes): name + note only,
  // never stored, sent with the next run's POST body.
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const canAttach = authed && tier !== null && (tier === "steady" || tier === "command" || tier === "ultimate");

  const handleEvent = useCallback((ev: ReviewEvent) => {
    const m = streamModeRef.current;
    if (ev.type === "start") {
      setMode(ev.mode);
      patch(m, { status: "streaming", blocks: [], error: "", quota: false });
      // Co-Parent Check-In: signal that a review is streaming (pill suppression).
      window.dispatchEvent(new CustomEvent("bys:review-streaming"));
      return;
    }
    if (ev.type === "error") {
      patch(m, { status: "error", error: ev.message });
      // P0 (2026-08-12): server-sent stream errors (provider timeout, empty
      // stream, 5xx burst) never threw, so review_failed never fired for them —
      // the dashboard only saw client-side rejections. Stamp the code the
      // server attached (empty_stream) or server_error.
      track("review_failed", { status: typeof ev.code === "string" ? ev.code : "server_error" });
      return;
    }
    if (ev.type === "done") {
      patch(m, { status: "done" });
      if (!exampleRunRef.current) hadSuccessRef.current = true;
      // Value gate (reward-loop spec): the first reward has landed — from here
      // the Special Offer may appear (still needs 2+ surfaces, never on /).
      markValueDelivered();
      if (m === "analyze") {
        // Analyzer completion (two-mode AI Co-Parent, 2026-08-11).
        track("analyze_completed", { auth: "anon", ...(exampleRunRef.current ? { example: true } : {}) });
      } else {
        // Capture-card A/B: the bys_capture_variant cookie is assigned at results
        // render (AFTER this done event for a fresh visitor), so the variant is
        // only present on review_completed when the cookie already existed —
        // omit it otherwise. email_captured is the event that MUST carry it.
        const variant = readCaptureVariant();
        // mode:"review" threads into the meta so /owner funnel panels split
        // cleanly between the two AI Co-Parent modes.
        track("review_completed", {
          ...(variant ? { auth: "anon", variant, mode: "review" } : { auth: "anon", mode: "review" }),
          ...(exampleRunRef.current ? { example: true } : {}),
        });
        // Round-6 guided funnel (R6-2): post-value entry point after the
        // first review or the free example lands. Delayed ~1.4s so the payoff
        // is seen first; GuidedFunnel (mounted in __root) decides eligibility
        // (signed-out, once per page load) and fires the funnel events.
        // Never carries draft text.
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("bys:guided-funnel"));
        }, 1400);
      }
      // Co-Parent Check-In: second-chance trigger — pill may re-appear once.
      window.dispatchEvent(new CustomEvent("bys:checkin-value"));
      // P1: bring the payoff into the first post-completion viewport WITHOUT a
      // manual scroll — unless the user is already looking at the results
      // (e.g. they scrolled down while the stream ran). scrollBehavior()
      // respects prefers-reduced-motion (auto instead of smooth).
      requestAnimationFrame(() => {
        const el = resultsWrapRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const vh = window.innerHeight || document.documentElement.clientHeight;
        if (r.top >= 0 && r.top < vh * 0.6 && r.bottom > 0) return; // already visible
        el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
      });
      return;
    }
    const { type, ...rest } = ev;
    patch(m, (s) => ({ blocks: [...s.blocks, { kind: type, ...rest } as ResultBlock] }));
  }, [patch]);

  async function runReview(text: string, example = false) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    streamModeRef.current = "review";
    setExampleResults(example);
    exampleRunRef.current = example;
    patch("review", { error: "", quota: false, status: "streaming", blocks: [] });
    trackFunnelOnce("funnel_started", { entry: "review" });
    track("review_started", { example: example ? true : undefined, auth: "anon", mode: "review" });
    try {
      await streamReview(text, handleEvent, ac.signal, {
        ...(example ? { example: true } : {}),
        ...(attachments.length ? { attachments } : {}),
      });
    } catch (err) {
      // P0 (2026-08-12): only swallow OUR OWN aborts (mode switch / a
      // superseding run — abortRef has moved on, so the state owner is
      // elsewhere). A foreign AbortError must land in a visible state too,
      // never a stuck "Reviewing…" forever.
      if ((err as Error).name === "AbortError") {
        if (abortRef.current !== ac) return;
        patch("review", { status: "error", error: "The review didn't come through. Check your connection and try again." });
        track("review_failed", { status: "aborted" });
        return;
      }
      const status = (err as Error & { status?: number }).status;
      const code = (err as Error & { code?: string }).code;
      const rawMsg = (err as Error).message || "";
      // Plain words for raw browser failures ("Failed to fetch" is developer
      // jargon, not a dad-facing message); everything else (server messages,
      // the calm timeout line) passes through untouched.
      const calmMsg = /failed to fetch|networkerror|network error|load failed|typeerror/i.test(rawMsg)
        ? "The review didn't come through. Check your connection and try again."
        : (rawMsg || "The review didn't come through. Check your connection and try again.");
      patch("review", { quota: status === 402, status: "error", error: status === 402 ? (hadSuccessRef.current ? "You've used your free review for today." : "Your first review is free — create your account and try again.") : calmMsg });
      // Provider-failure telemetry for the owner dashboard: status surfaces
      // 429/503/5xx bursts under ad traffic (see /owner funnel panels); a
      // deadline hit surfaces as timeout:true so the owner dashboard can tell
      // a slow-provider evening from a real failure (audit b244962). The
      // streamNDJSON code (empty_stream/eof/empty_body/http_*) beats a generic
      // "unknown" so the silent-dead-end class is visible in metrics.
      const isTimeout = rawMsg === "This is taking longer than usual. You can retry — nothing's lost.";
      track("review_failed", { status: code || status || "unknown", ...(isTimeout ? { timeout: true } : {}) });
    }
    // P2.3: after the example run finishes (success OR failure), swap the
    // canned example back out for the user's own state — their draft and any
    // of their previous results must survive the example tap. Only the canned
    // example is treated as "no real draft" (stays on screen for fresh
    // visitors — the honesty ask is exactly what they should see next).
    if (example && exampleBackupRef.current) {
      const b = exampleBackupRef.current;
      exampleBackupRef.current = null;
      if (b.draft.trim().length > 0 && b.draft !== EXAMPLE_DRAFT) {
        // P0 (2026-08-12): never clobber a FAILED example run's error card with
        // idle — the dad needs the calm error + retry, not silence. The draft
        // restore still happens (the fallback's Save button uses HIS draft).
        patch("review", (s) => ({
          draft: b.draft,
          blocks: b.blocks,
          ...(s.status !== "error" ? { status: (b.blocks.length === 0 ? "idle" : "done") as Status } : {}),
        }));
        setExampleResults(false);
      }
    }
  }

  async function runAnalyze(text: string) {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    streamModeRef.current = "analyze";
    patch("analyze", { error: "", quota: false, status: "streaming", blocks: [] });
    track("analyze_started", { auth: "anon" });
    try {
      await streamAnalyze(text, handleEvent, ac.signal, attachments);
    } catch (err) {
      // P0 (2026-08-12): same invariant as the review path — a foreign abort
      // lands in a visible calm error, never a stuck "Analyzing…".
      if ((err as Error).name === "AbortError") {
        if (abortRef.current !== ac) return;
        patch("analyze", { status: "error", error: "The analysis didn't come through. Check your connection and try again." });
        track("review_failed", { status: "aborted", mode: "analyze" });
        return;
      }
      const status = (err as Error & { status?: number }).status;
      const code = (err as Error & { code?: string }).code;
      const rawMsg = (err as Error).message || "";
      const calmMsg = /failed to fetch|networkerror|network error|load failed|typeerror/i.test(rawMsg)
        ? "The analysis didn't come through. Check your connection and try again."
        : (rawMsg || "The analysis didn't come through. Check your connection and try again.");
      patch("analyze", { quota: status === 402, status: "error", error: status === 402 ? (hadSuccessRef.current ? "You've used your free use for today." : "Your first use is free — create your account and try again.") : calmMsg });
      track("review_failed", { status: code || status || "unknown", mode: "analyze" });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submittingRef.current) return; // one request per click, ever
    const text = st.draft.trim();
    if (!text) return;
    submittingRef.current = true;
    // Hero A/B click measurement (use-first rebuild): the hero CTA buttons were
    // replaced by the paste box itself, so the submit here is the hero action.
    // data-hero-variant is set pre-paint by the index.tsx head script.
    track("hero_cta_click", {
      variant:
        typeof document !== "undefined" &&
        document.documentElement.getAttribute("data-hero-variant") === "b"
          ? "b"
          : "a",
    });
    const run = tool === "analyze" ? runAnalyze(text) : runReview(text);
    void run.finally(() => {
      submittingRef.current = false;
    });
  }

  // Mode switch (spec §1): NO analytics inside ModeSwitch — the parent fires
  // mode_switched here. Switching away mid-stream aborts the stream (the
  // server refunds the quota slot via the abort path); the aborted mode is
  // reset to idle so switching back never shows a stuck "streaming" state.
  // Drafts and finished results live per-mode, so nothing is lost.
  function switchTool(m: ToolMode) {
    if (m === tool) return;
    if (st.status === "streaming") {
      abortRef.current?.abort();
      abortRef.current = null;
      patch(tool, { status: "idle", blocks: [], error: "", quota: false });
    }
    setTool(m);
    track("mode_switched", { mode: m });
  }

  // One-tap live demo (REVIEW MODE ONLY — the analyzer gets prompt chips):
  // fill the example draft and immediately run a REAL streaming review flagged
  // example:true — the server streams it normally but never counts it against
  // the anonymous daily free review or saves it, so "your first review is
  // always free" stays true for first-time visitors.
  // P2.3: the user's own draft/results are stashed FIRST — the example never
  // clobbers their 30-second draft; it's swapped back when the run finishes.
  function fillExampleAndRun() {
    exampleBackupRef.current = { draft: reviewState.draft, blocks: reviewState.blocks };
    patch("review", { draft: EXAMPLE_DRAFT, status: "idle", error: "", quota: false });
    // example:true is the whole point — the server streams this like a real
    // review but never counts it against the anonymous daily free review.
    void runReview(EXAMPLE_DRAFT, true);
  }

  // P2.1: from the example honesty ask — clear the sample and hand the box
  // back to the dad so pasting/running HIS message is one tap away.
  function useOwnMessage() {
    exampleBackupRef.current = null;
    patch("review", { draft: "", status: "idle", blocks: [] });
    requestAnimationFrame(() => {
      document.getElementById("draft")?.focus();
    });
  }

  // Landing hero "See an example review →" ghost link dispatches this event;
  // fill + run, then bring the tool into view. The example is review-only — if
  // the visitor is in analyze mode, hop them back to review first.
  useEffect(() => {
    const onExample = () => {
      if (toolRef.current !== "review") setTool("review");
      fillExampleAndRun();
      reviewRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    };
    window.addEventListener("bys:example", onExample);
    return () => window.removeEventListener("bys:example", onExample);
  }, []);

  // Gentle prompt chips: append the label line into the textarea + refocus.
  function appendChip(prefix: string) {
    const cur = st.draft;
    const sep = cur.trim() && !/\n$/.test(cur) ? "\n" : "";
    patch(tool, { draft: cur + sep + prefix });
    requestAnimationFrame(() => {
      const el = document.getElementById("draft") as HTMLTextAreaElement | null;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    });
  }

  const canSubmit = st.draft.trim().length > 0 && st.status !== "streaming";
  const showResults = st.blocks.length > 0 || st.status === "streaming" || st.status === "done" || st.status === "error";
  const isAnalyze = tool === "analyze";

  return (
    <section
      ref={reviewRef}
      id="review"
      className="scroll-mt-24"
      aria-label="Free message review"
    >
      <div className="rounded-[2rem] border border-line bg-card p-6 shadow-card sm:p-8 max-[340px]:p-5">
        <form onSubmit={onSubmit} noValidate>
          {/* Two-mode AI Co-Parent: the mode pill is the FIRST element of the
              card (spec §1). Order: [ModeSwitch] → [label] → [TomorrowDrafts] →
              [textarea] → [footer row] → [submit]. */}
          <ModeSwitch mode={tool} onChange={switchTool} />
          <label htmlFor="draft" key={tool} className="field-label bys-mode-settle mt-5">
            {isAnalyze ? "What happened?" : "Your message to your co-parent"}
          </label>
          <TomorrowDraftsList onLoad={(t) => { patch(tool, { draft: t }); }} />
          <textarea
            id="draft"
            value={st.draft}
            onChange={(e) => { patch(tool, { draft: e.target.value }); onTyping(); }}
            onFocus={onTyping}
            onBlur={clearTyping}
            placeholder={isAnalyze ? "Tell it like it happened — what they said, what you did, where it left things. No need to be perfect." : "Paste or type the message you're about to send…"}
            rows={6}
            maxLength={5000}
            className="input min-h-44 resize-y text-base leading-relaxed"
          />
          {/* Attach chips (Steady+): between the textarea and the footer row. */}
          {attachments.length > 0 && (
            <AttachChips
              mode={tool}
              attachments={attachments}
              onRemove={(name) => setAttachments((prev) => prev.filter((a) => a.name !== name))}
            />
          )}
          {/* Footer row — live counter + attach control, one right-aligned line
              (landing-redesign F3; the counter keeps the honest 0/5000 readout). */}
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="text-sm text-stone">{st.draft.trim().length || 0}/5000</span>
            <AttachControl
              mode={tool}
              canAttach={canAttach}
              signedOut={!authed}
              attachments={attachments}
              onChange={setAttachments}
              disabled={st.status === "streaming"}
            />
          </div>
          {/* Quiet full-width rows above submit: review = the example chip;
              analyze = the prompt chips (auto-hide once typed >120 chars). */}
          {isAnalyze ? (
            st.draft.trim().length <= 120 && (
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="What happened">
                {PROMPT_CHIPS.map((c) => (
                  <button key={c.label} type="button" onClick={() => appendChip(c.prefix)} className="chip">
                    {c.label}
                  </button>
                ))}
              </div>
            )
          ) : (
            <div className="mt-2 flex w-full justify-center">
              <button type="button" onClick={fillExampleAndRun} className="chip">
                No draft? See a real example →
              </button>
            </div>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="btn-primary mt-5 w-full text-lg"
          >
            <span key={tool} className="bys-mode-settle">
              {st.status === "streaming"
                ? isAnalyze ? "Analyzing…" : "Reviewing…"
                : isAnalyze ? "Analyze this situation" : "Review My Message"}
            </span>
          </button>
          <p className="mt-3 text-center text-base text-stone">
            Free · No account · Private
          </p>
          <p className="mt-1 text-center text-sm text-taupe">
            Usually about 10–20 seconds.
          </p>
        </form>

        {showResults && (
          <div ref={resultsWrapRef} aria-live="polite" className="scroll-mt-24">
            {st.status === "error" && (
              st.quota ? (
                <div className="mt-8 rounded-3xl border border-red-300 bg-red-50 p-6">
                  <p className="text-base text-red-900">{st.error}</p>
                  <QuotaCTA draft={st.draft} />
                </div>
              ) : (
                <ReviewFallback draft={st.draft} error={st.error} onRetry={() => { const t = st.draft; void (isAnalyze ? runAnalyze(t) : runReview(t, t === EXAMPLE_DRAFT)); }} />
              )
            )}
            {st.status !== "error" && (
              <ReviewResults
                blocks={st.blocks}
                mode={mode}
                draft={st.draft}
                streaming={st.status === "streaming"}
                example={exampleResults}
                captureAsk={!authed}
                hideCapture={authed}
                tool={tool}
                onUseOwnMessage={useOwnMessage}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

// The real fix for a 402 quota block: create a free account (5 uses/month —
// reviews AND situation analyses share the pool). Retry can never succeed
// against a live quota limit, so the primary action is the account flow; the
// honest "resets tomorrow" message stays visible.
function QuotaCTA({ draft }: { draft: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [confirmLink, setConfirmLink] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setState("error");
      setError("Enter your email so we can create your free account.");
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setState("error");
      setError("That email doesn't look right — double-check it.");
      return;
    }
    setState("saving");
    setError("");
    const res = await saveReview(value, draft, "");
    if (res.ok) {
      setConfirmLink(confirmPath(res.token, res.link));
      setState("saved");
      track("email_submitted", {});
    } else {
      setState("error");
      setError(res.message || "Could not create your account right now.");
    }
  }

  if (state === "saved") {
    return (
      <div className="mt-4 rounded-3xl border border-forest/25 bg-forest p-6 text-cream">
        <p className="text-lg font-semibold">Your free account is one step away.</p>
        <p className="mt-2 text-base text-cream/85">
          Your draft is saved and waiting. Use the in-app confirmation below to unlock 5 free uses a month.
        </p>
        {confirmLink ? (
          <a href={confirmLink} className="mt-4 inline-flex min-h-11 items-center font-semibold text-cream underline underline-offset-4">
            Continue in the app →
          </a>
        ) : (
          <p className="mt-4 text-base text-cream/85">Use the confirmation link in this app to continue.</p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 rounded-3xl border border-forest/25 bg-forest p-6 text-cream" noValidate>
      <p className="text-lg font-semibold">A free account gives you 5 uses every month — reviews and situation analyses both — and your history is saved.</p>
      <p className="mt-1 text-base text-cream/85">Your draft stays here — we'll save it to your new account.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="quota-email" className="sr-only">Email address</label>
        <input
          id="quota-email"
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
          className="min-h-12 w-full rounded-xl border border-line bg-cream px-5 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
          required
        />
        <button type="submit" disabled={state === "saving"} className="btn-primary shrink-0">
          {state === "saving" ? "Creating…" : "Get my free account"}
        </button>
      </div>
      {state === "error" && error && (
        <p role="alert" className="mt-3 text-base text-cream">
          {error}
        </p>
      )}
    </form>
  );
}

// The human failure fallback (owner direction, 2026-08-10): when a review fails
// after the automatic retries, never dead-end the dad. He can save his message
// through the existing account-creation flow (/api/save — draft carried along,
// so nothing is lost) or retry the same quota-safe request. A failed core
// result is never a moment for a payment pitch.
function ReviewFallback({ draft, error, onRetry }: { draft: string; error: string; onRetry: () => void }) {
  const [showSave, setShowSave] = useState(false);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [confirmLink, setConfirmLink] = useState("");

  async function save(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setState("error");
      setSaveError("Enter your email so we can save your message.");
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setState("error");
      setSaveError("That email doesn't look right — double-check it.");
      return;
    }
    setState("saving");
    setSaveError("");
    const res = await saveReview(value, draft, "");
    if (res.ok) {
      setConfirmLink(confirmPath(res.token, res.link));
      setState("saved");
      track("email_submitted", {});
    } else {
      setState("error");
      setSaveError(res.message || "Could not save your message right now.");
    }
  }

  if (state === "saved") {
    return (
      <div className="mt-8 rounded-3xl border border-forest/25 bg-forest p-6 text-cream">
        <p className="text-lg font-semibold">Your message is saved and waiting.</p>
        <p className="mt-2 text-base text-cream/85">
          Your draft is on its way to your record — confirm below and it's yours.
        </p>
        {confirmLink ? (
          <a href={confirmLink} className="mt-4 inline-flex min-h-11 items-center font-semibold text-cream underline underline-offset-4">
            Continue in the app →
          </a>
        ) : (
          <p className="mt-4 text-base text-cream/85">Use the confirmation link in this app to continue.</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8 rounded-3xl border-2 border-forest bg-card p-6 shadow-card">
      <p className="text-lg font-semibold leading-snug text-forest">The review engine is taking a break right now.</p>
      <p className="mt-2 text-base leading-relaxed text-stone">
        Late night for the review engine — it'll be back shortly. Your message matters, and we don't want you to lose it. Here's what we can do:
      </p>
      {error && <p className="mt-2 text-sm text-taupe">{error}</p>}

      {!showSave ? (
        <button type="button" onClick={() => setShowSave(true)} className="btn-primary mt-5 w-full text-lg">
          Save my message — it's free
        </button>
      ) : (
        <form onSubmit={save} className="mt-5 rounded-2xl border border-line bg-cream p-4" noValidate>
          <label htmlFor="fallback-email" className="field-label">
            Email address
          </label>
          <input
            id="fallback-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (state === "error") {
                setState("idle");
                setSaveError("");
              }
            }}
            className="min-h-12 w-full rounded-xl border border-line bg-card px-5 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
            required
          />
          <button type="submit" disabled={state === "saving"} className="btn-primary mt-3 w-full">
            {state === "saving" ? "Saving…" : "Save my message — it's free"}
          </button>
          {state === "error" && saveError && (
            <p role="alert" className="mt-3 text-base text-red-800">
              {saveError}
            </p>
          )}
        </form>
      )}
      <p className="mt-3 text-center text-sm text-stone">No card. No spam. Your message stays yours.</p>

      <button type="button" onClick={onRetry} className="btn-ghost mt-4 w-full">
        Try again
      </button>
    </div>
  );
}
