import { useCallback, useEffect, useRef, useState } from "react";
import { track, trackFunnelOnce } from "~/lib/analytics";
import { authMeOnce } from "~/lib/checkin";
import { modalOpen, claimModal, releaseModal } from "~/lib/trial";
import { IconArrowLeft, IconCheck, IconClose } from "./icons";

// Round-6 guided funnel (Codex R6-2, 2026-08-13): after the first free review
// OR the free example completes on /, a short 3-step mobile flow —
//   1. "What do you need most right now?" (tap-to-select cards)
//   2. a brief privacy/trust reassurance
//   3. recommended plan (existing pricing only) or a free account
// Post-value only (never before the first complete review), signed-out
// visitors only, once per page load (per-tab session flag). Answers persist
// locally as NON-SENSITIVE slugs in sessionStorage — never in URLs — and a
// reload mid-flow resumes exactly where the dad left off. Wires to the
// existing funnel events: funnel_started {entry}, funnel_step_viewed {step},
// funnel_option_selected {step|plan} — answer text never leaves the device.
// No new pricing/plans are invented: the final step points at the existing
// pricing page (/pricing) and the existing free-account path (/login).

export type GuidedNeed = "calmer_replies" | "keep_records" | "clear_summary";

const NEED_OPTIONS: { value: GuidedNeed; label: string; sub: string }[] = [
  { value: "calmer_replies", label: "Calmer replies", sub: "So messages stop escalating." },
  { value: "keep_records", label: "Keep records organized", sub: "Everything filed, ready if you need it." },
  { value: "clear_summary", label: "Prepare a clear summary", sub: "Your situation, in one calm page." },
];

// Deterministic need → plan mapping. Existing plans + existing prices only
// (the same numbers as /pricing) — nothing invented here.
const NEED_PLAN: Record<GuidedNeed, { plan: "steady" | "command"; name: string; price: string; why: string }> = {
  calmer_replies: { plan: "steady", name: "Steady", price: "$4.99/mo", why: "Calmer replies, kept in your record." },
  keep_records: { plan: "command", name: "Command Center", price: "$12.49/mo", why: "Your evidence, organized and ready." },
  clear_summary: { plan: "command", name: "Command Center", price: "$12.49/mo", why: "Turns your record into one clear summary." },
};

const STATE_KEY = "bys_guided_funnel_state";
const SEEN_KEY = "bys_guided_funnel_seen";

type FlowState = { step: number; need: GuidedNeed | null };

function readState(): FlowState | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Partial<FlowState>;
    const step = typeof j.step === "number" && j.step >= 0 && j.step <= 2 ? j.step : 0;
    const need = j.need && NEED_OPTIONS.some((o) => o.value === j.need) ? j.need : null;
    return { step, need };
  } catch {
    return null;
  }
}
function writeState(s: FlowState): void {
  try {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — the flow still works in memory */
  }
}
function clearState(): void {
  try {
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* noop */
  }
}
function seenThisTab(): boolean {
  try {
    return !!sessionStorage.getItem(SEEN_KEY);
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* noop */
  }
}

export default function GuidedFunnel() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0); // 0=need 1=privacy 2=plan/free
  const [need, setNeed] = useState<GuidedNeed | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const needFiredRef = useRef(false); // funnel_option_selected {step:"need"} once per flow
  // Keep the keydown trap's Escape on the latest handler without re-running
  // the focus/scroll-lock effect on every step change.
  const dismissRef = useRef<() => void>(() => {});
  const stepRef = useRef(step);
  stepRef.current = step;
  const needRef = useRef(need);
  needRef.current = need;
  // Poll handle for the modal-lock deferral (FIX 1): cleared on unmount.
  const deferTimerRef = useRef<number | null>(null);

  // Trigger: ReviewTool dispatches "bys:guided-funnel" ~1.4s after a review
  // (or the free example) completes. Eligibility: signed-out, not seen this
  // tab — UNLESS a mid-flow state was saved (reload / back-navigation), in
  // which case the funnel resumes from the persisted step even when the seen
  // flag survived (R6-3: the resume path was unreachable because the seen
  // check short-circuited the trigger). The funnel also defers to the shared
  // modal lock (TrialModal / Special Offer): if another dialog is up when the
  // trigger fires, it waits for the lock to clear, then opens in this same
  // session — never two dialogs in the DOM at once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const openIfEligible = (saved: FlowState | null) => {
      authMeOnce().then((a) => {
        if (a.signedIn) return; // already has an account — nothing to capture
        if (modalOpen()) return; // another dialog claimed the lock — never stack
        setNeed(saved?.need ?? null);
        setStep(saved?.step ?? 0);
        needFiredRef.current = !!saved?.need; // a resumed flow already picked
        markSeen();
        setOpen(true); // the open effect claims the modal lock
      });
    };
    const onTrigger = () => {
      const saved = readState();
      if (!saved && seenThisTab()) return;
      if (modalOpen()) {
        // TrialModal/SpecialOffer holds the shared window lock — the funnel
        // must never stack on top. Wait for the lock to clear, then open in
        // this same session. Give up quietly after 60s rather than ever
        // stacking (the post-value moment has decayed by then).
        const start = Date.now();
        const iv = window.setInterval(() => {
          if (!modalOpen()) {
            window.clearInterval(iv);
            deferTimerRef.current = null;
            openIfEligible(saved);
          } else if (Date.now() - start > 60000) {
            window.clearInterval(iv);
            deferTimerRef.current = null;
          }
        }, 250);
        deferTimerRef.current = iv;
      } else {
        openIfEligible(saved);
      }
    };
    window.addEventListener("bys:guided-funnel", onTrigger);
    return () => {
      window.removeEventListener("bys:guided-funnel", onTrigger);
      if (deferTimerRef.current !== null) {
        window.clearInterval(deferTimerRef.current);
        deferTimerRef.current = null;
      }
    };
  }, []);

  // Funnel events: funnel_started once per tab (trackFunnelOnce guards it),
  // funnel_step_viewed on every step that renders.
  useEffect(() => {
    if (!open) return;
    trackFunnelOnce("funnel_started", { entry: "post-review" });
    const steps = ["need", "privacy", "plan"] as const;
    track("funnel_step_viewed", { step: steps[stepRef.current] });
  }, [open, step]);

  // Dialog focus management: focus the panel on open, trap Tab inside it,
  // close on Escape, lock body scroll, restore focus on close. Also claims
  // the shared modal lock while open (TrialModal/Special Offer see it and
  // defer — the funnel can never stack with another dialog, R6-3) and
  // releases it on close AND on unmount via this effect's cleanup.
  useEffect(() => {
    if (!open) return;
    claimModal();
    lastFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismissRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      releaseModal();
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey, true);
      lastFocus.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const dismiss = useCallback(() => {
    clearState();
    setOpen(false);
  }, []);
  dismissRef.current = dismiss;

  const back = useCallback(() => {
    const next = Math.max(0, stepRef.current - 1);
    setStep(next);
    writeState({ step: next, need: needRef.current });
  }, []);

  const pick = useCallback((v: GuidedNeed) => {
    setNeed(v);
    writeState({ step: stepRef.current, need: v });
  }, []);

  const continueFrom = useCallback(() => {
    // Step 0 → 1. Fires the option event ONCE (the need itself stays local —
    // only the step identifier rides the funnel event).
    if (stepRef.current === 0 && needRef.current) {
      if (!needFiredRef.current) {
        needFiredRef.current = true;
        track("funnel_option_selected", { step: "need" });
      }
      setStep(1);
      writeState({ step: 1, need: needRef.current });
      return;
    }
    // Step 1 → 2.
    if (stepRef.current === 1) {
      setStep(2);
      writeState({ step: 2, need: needRef.current });
    }
  }, []);

  const goFree = useCallback(() => {
    // "Continue free" — always visible, honest free-account path.
    track("funnel_option_selected", { plan: "free" });
    clearState();
    window.location.href = "/login";
  }, []);

  const seePlan = useCallback(() => {
    const n = needRef.current;
    if (n) track("funnel_option_selected", { plan: NEED_PLAN[n].plan });
    clearState();
    window.location.href = "/pricing";
  }, []);

  const plan = need ? NEED_PLAN[need] : null;
  const dots = step === 0 ? 1 : step === 1 ? 2 : 3;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[50]" role="dialog" aria-modal="true" aria-label="Three quick questions — then your plan or a free account">
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] min-h-[62dvh] flex-col rounded-t-[14px] border-t border-line bg-card shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:min-h-0 sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:rounded-[14px] sm:border"
      >
        <div className="bys-grabber sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 px-6 pt-5 sm:pt-6">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < dots ? "bg-forest" : "bg-line"}`} />
              ))}
            </div>
            {step > 0 && (
              <button type="button" onClick={back} className="inline-flex min-h-11 items-center text-base font-semibold text-forest">
                <IconArrowLeft className="h-5 w-5" /> Back
              </button>
            )}
          </div>
          <button type="button" onClick={dismiss} className="icon-btn min-h-11 text-stone" aria-label="Close">
            <IconClose className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-2 pt-5">
          {step === 0 && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">One more thing</p>
              <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-forest">What do you need most right now?</h2>
                            <div className="mt-5 flex flex-col gap-2.5">
                {NEED_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => pick(o.value)}
                    aria-pressed={need === o.value}
                    className={`flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl border px-4 text-left transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${need === o.value ? "border-forest bg-forest/10" : "border-line bg-cream"}`}
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-stone/40 bg-card">
                      {need === o.value && <IconCheck className="h-4 w-4 text-forest" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-base font-semibold text-ink">{o.label}</span>
                      <span className="block text-sm leading-snug text-stone">{o.sub}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Private by design</p>
              <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-forest">What you write stays between us.</h2>
              <ul className="mt-5 space-y-3">
                {[
                  "Your draft isn't stored — unless you save it to your own account.",
                  "We never sell or share your situation.",
                  "This is communication guidance, not legal advice.",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-3 text-base leading-relaxed text-ink">
                    <IconCheck className="mt-1 h-5 w-5 shrink-0 text-forest" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Your call</p>
              <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-forest">Where would you like to take this?</h2>
              {plan ? (
                <button
                  type="button"
                  onClick={seePlan}
                  className="card mt-5 block w-full border-forest/40 p-5 text-left transition-colors hover:bg-cream-deep active:scale-[0.99]"
                >
                  <span className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Recommended for you</span>
                  <span className="mt-1 block font-display text-xl font-semibold text-forest">{plan.name}</span>
                  <span className="mt-1 block text-base leading-relaxed text-stone">{plan.why}</span>
                  <span className="mt-2 block text-base font-semibold text-ink">
                    {plan.price} <span className="font-normal text-stone">· Cancel anytime</span>
                  </span>
                  <span className="mt-2 block text-base font-semibold text-forest">See {plan.name} →</span>
                </button>
              ) : (
                <p className="mt-5 rounded-xl bg-cream-deep px-4 py-3 text-base leading-relaxed text-stone">
                  Steady keeps replies calm; Command Center organizes the record.
                </p>
              )}
              <a href="/pricing" onClick={() => { clearState(); }} className="mt-4 block min-h-11 text-center text-base font-semibold text-forest underline">
                See all plans →
              </a>
            </>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-6 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
          {step < 2 ? (
            <div>
              <button
                type="button"
                onClick={continueFrom}
                disabled={step === 0 && !need}
                className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === 0 ? (need ? "Continue" : "Pick one to continue") : "Continue"}
              </button>
              {/* "Continue free" is ALWAYS visible (owner work order, R6): the
                  free path is one tap away on every step — no card needed.
                  Kept visually secondary (quiet text link) so the primary
                  choice stays clear. Same handler as step 2 — identical event
                  behavior, exactly once per tap. */}
              <button
                type="button"
                onClick={goFree}
                className="mt-1 block w-full min-h-11 text-center text-sm font-semibold text-stone transition-colors hover:text-forest"
              >
                Continue free
              </button>
              <p className="mt-0.5 text-center text-xs leading-relaxed text-stone/85">Free account · no card needed · in about 10 seconds.</p>
            </div>
          ) : (
            <div>
              <button type="button" onClick={goFree} className="btn-primary w-full">
                Continue free
              </button>
              <p className="mt-2 text-center text-sm leading-relaxed text-stone">Free account · no card needed · in about 10 seconds.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
