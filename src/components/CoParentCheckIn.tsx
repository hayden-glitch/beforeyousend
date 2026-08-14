import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import { offerAccepted, purchasedThisSession } from "~/lib/offer";
import {
  getCheckinGroup,
  checkinPathAllowed,
  checkinDone,
  checkinShownThisSession,
  checkinDismissedThisSession,
  markCheckinShown,
  markCheckinDismissed,
  markCheckinDone,
  isPaidUser,
  recommend,
  planName,
  Q1_CHIPS,
  Q2_CHIPS,
  Q3_CHIPS,
  Q_LABELS,
  type CheckinRec,
} from "~/lib/checkin";
import { IconArrowLeft, IconClose } from "./icons";

// The Co-Parent Check-In: teaser pill → 3-question bottom sheet → matched plan
// with 50% off the first 3 months. Honest mechanics per spec: no countdown,
// full price math always, "Cancel anytime", "Not legal advice" micro-line.
// Group is cookie-keyed (bys_checkin, 25% default) by the __root head script.
// Never coexists with SpecialOffer (z-40): pill is z-[35], sheet replaces the
// pill, and the same suppression guards that drive offer.ts apply here.

// Session-scoped flags shared across route changes (module scope, like offer.ts).
const autoHidden = { v: false }; // pill auto-hid because the review tool is in use
const streaming = { v: false }; // a review is streaming right now

export default function CoParentCheckIn() {
  const { pathname } = useLocation();
  const [pill, setPill] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [step, setStep] = useState(0); // 0=Q1, 1=Q2, 2=Q3, 3=result
  const [q1, setQ1] = useState<string>();
  const [q2, setQ2] = useState<string>();
  const [q3, setQ3] = useState<string>();
  const [skipped, setSkipped] = useState(false);
  const [rec, setRec] = useState<CheckinRec | null>(null);
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [msg, setMsg] = useState("");
  const [paid, setPaid] = useState(false);
  const [animKey, setAnimKey] = useState(0); // re-mounts step content (120ms fade/slide)
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const group = getCheckinGroup();

  // Paid-tier suppression flag, fetched once per page load (cached in checkin.ts).
  // Only fetched for the on-group (75% of visitors never hit /api/auth/me).
  useEffect(() => {
    if (group !== "on") return;
    let alive = true;
    isPaidUser().then((p) => {
      if (alive) setPaid(p);
    });
    return () => {
      alive = false;
    };
  }, [group]);

  const eligible = useCallback(() => {
    if (typeof window === "undefined") return false;
    return (
      group === "on" &&
      checkinPathAllowed(pathname) &&
      !checkinDone() &&
      !checkinShownThisSession() &&
      !checkinDismissedThisSession() &&
      !offerAccepted() &&
      !purchasedThisSession() &&
      !paid &&
      !streaming.v &&
      !autoHidden.v
    );
  }, [group, pathname, paid]);

  const showPill = useCallback(
    (trigger: "timer" | "value") => {
      if (!eligible()) return;
      setPill(true);
      markCheckinShown();
      track("checkin_shown", { path: pathname, trigger });
    },
    [eligible, pathname]
  );

  // Trigger: value only (owner 2026-08-10 use-first funnel). The 8s cold-landing
  // timer was removed — the Check-In must never interrupt the paste-box flow
  // before the visitor has gotten value. "bys:checkin-value" is dispatched by
  // ReviewTool/home right after track("review_completed"); "bys:checkin-result"
  // by the Check-In's own result screen, so the promo loop stays alive.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onValue = () => {
      streaming.v = false;
      showPill("value");
    };
    const onStreaming = () => {
      streaming.v = true;
      setPill(false); // never block the tool
    };
    // Capture-moment redesign (P1.2): the mobile capture sheet owns the bottom
    // of the screen — hide the Check-In pill while it's up (z-[36] vs z-[35],
    // never two competing asks). No re-show; the pill's one-shot session flag
    // already fired.
    const onCaptureAsk = () => {
      setPill(false);
    };
    window.addEventListener("bys:checkin-value", onValue);
    window.addEventListener("bys:review-streaming", onStreaming);
    window.addEventListener("bys:capture-ask-open", onCaptureAsk);
    return () => {
      window.removeEventListener("bys:checkin-value", onValue);
      window.removeEventListener("bys:review-streaming", onStreaming);
      window.removeEventListener("bys:capture-ask-open", onCaptureAsk);
    };
  }, [showPill]);

  // Auto-hide when the review textarea receives focus (or review_typing_started
  // equivalent) — focusin on #draft / #home-draft; no re-show this session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.id === "draft" || t.id === "home-draft" || !!t.closest?.("#draft,#home-draft"))) {
        autoHidden.v = true;
        setPill(false);
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, []);

  // Dialog focus management: focus the panel on open, trap Tab inside it,
  // close on Escape, lock body scroll, restore focus on close.
  useEffect(() => {
    if (!sheet) return;
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
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey, true);
      lastFocus.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  const dismiss = useCallback(() => {
    track("checkin_dismissed", {
      step,
      answers: { q1: q1 || undefined, q2: q2 || undefined, q3: q3 || undefined },
    });
    markCheckinDismissed();
    setSheet(false);
    setPill(false);
  }, [step, q1, q2, q3]);
  // Keep the keydown trap's Escape on the latest dismiss (fresh answers) without
  // re-running the focus/scroll-lock effect on every answer tap.
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;

  const open = useCallback(() => {
    if (typeof window === "undefined") return;
    track("checkin_started", { path: pathname });
    setStep(0);
    setSkipped(false);
    setQ1(undefined);
    setQ2(undefined);
    setQ3(undefined);
    setRec(null);
    setMsg("");
    setPill(false);
    setSheet(true);
  }, [pathname]);

  // 120ms slide/fade between steps: re-mount the step content with a fade-in.
  const advance = useCallback((fn: () => void) => {
    setAnimKey((k) => k + 1);
    setTimeout(fn, 120);
  }, []);

  const answer = useCallback(
    (which: 1 | 2 | 3, value: string) => {
      track(`checkin_q${which}_answered`, { answer: value });
      if (which === 1) {
        setQ1(value);
        advance(() => setStep(1));
      } else if (which === 2) {
        setQ2(value);
        advance(() => setStep(2));
      } else {
        setQ3(value);
        const nextQ1 = q1;
        const nextQ2 = q2;
        const next = recommend(nextQ1, nextQ2, value);
        advance(() => {
          setRec(next);
          setStep(3);
          if (next) {
            track("checkin_recommended", {
              plan: next.plan,
              rec: next.rec,
              q1: nextQ1 || undefined,
              q2: nextQ2 || undefined,
              q3: value,
              price: next.price,
            });
          }
          markCheckinDone();
        });
      }
    },
    [advance, q1, q2]
  );

  const skip = useCallback(() => {
    track("checkin_skipped", {});
    setSkipped(true);
    setRec(null);
    markCheckinDone();
    advance(() => setStep(3));
  }, [advance]);

  const back = useCallback(() => {
    setAnimKey((k) => k + 1);
    setTimeout(() => setStep((s) => Math.max(0, s - 1)), 120);
  }, []);

  const cta = useCallback(async () => {
    if (!rec) return;
    track("checkin_cta_clicked", { plan: rec.plan, price: rec.price });
    track("checkout_started", { plan: rec.plan, interval: "month", source: "checkin" });
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Track B items 2+3: only the plan + checkin marker ride the request —
        // the answers (q1/q2/q3/rec) never leave this device, so nothing
        // sensitive can reach Stripe metadata or any URL.
        body: JSON.stringify({ plan: rec.plan, interval: "month", checkin: true }),
      });
      const d = await r.json();
      if (d.url) {
        markCheckinDone();
        location.href = d.url;
        return;
      }
      if (r.status === 401 || d.login_required) {
        setMsg("Sign in to finish — your answers are still on this page, and your purchase will be linked to your account.");
        setNeedLogin(true);
        return;
      }
      setMsg(d.error || "Checkout is not available right now.");
    } catch {
      setMsg("Checkout is not available right now.");
    }
    setBusy(false);
  }, [rec]);

  if (group !== "on") return null;

  const mirrorLine = q1 || q2 || q3
    ? `For: ${[q1, q2, q3].filter(Boolean).map((a) => Q_LABELS[a as string] || a).join(" · ")}`
    : null;
  // Progress dots: one active dot per answered/current step — Q1 shows its own
  // dot active (step 0 counts as "on question one"), Q2/Q3 the dots behind them.
  const answeredDots = step === 0 ? 1 : step === 1 ? 1 : step === 2 ? 2 : 3;

  return (
    <>
      {pill && !sheet && (
        <div
          className={`fixed z-[35] left-1/2 w-[92vw] max-w-md -translate-x-1/2 ${pathname === "/home" ? "bottom-[max(calc(84px+env(safe-area-inset-bottom)),5.5rem)]" : "bottom-[max(12px,env(safe-area-inset-bottom))]"}`}
        >
          <div className="flex items-center gap-3 rounded-full border border-forest/30 bg-forest py-3 pl-5 pr-3 shadow-lg">
            <button
              type="button"
              onClick={open}
              className="flex-1 text-left text-sm font-medium leading-snug text-cream"
              aria-label="3 questions to a plan matched to you — 50% off your first 3 months"
            >
              <span className="block">3 questions → a plan matched to you.</span>
              <span className="block">50% off your first 3 months.</span>
            </button>
            <button
              type="button"
              onClick={() => {
                track("checkin_dismissed", { step: 0, answers: {} });
                markCheckinDismissed();
                setPill(false);
              }}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream/80"
              aria-label="Dismiss"
            >
              <IconClose className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Co-Parent Check-In — three questions, a plan matched to you">
          <button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
          />
          <div
            ref={panelRef}
            tabIndex={-1}
            className="bys-sheet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-[2rem] border-t-2 border-forest bg-card p-6 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:rounded-[2rem] sm:border-2"
          >
            <div className="bys-grabber" aria-hidden="true" />
            <div className="flex items-center justify-between gap-4">
              {step < 3 ? (
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`h-1.5 w-1.5 rounded-full ${i < answeredDots ? "bg-forest" : "bg-line"}`}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">
                  {skipped ? "The 50% offer" : "Your match"}
                </p>
              )}
              <button
                type="button"
                onClick={dismiss}
                className="icon-btn min-h-11 text-stone"
                aria-label="Close"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>

            <div key={animKey} className="bys-checkin-step mt-4">
              {step === 0 && (
                <>
                  <h2 className="font-display text-2xl font-semibold leading-tight text-forest">
                    What's your situation?
                  </h2>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    {Q1_CHIPS.map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => answer(1, v)}
                        className={`min-h-[3.25rem] w-full rounded-2xl border px-4 text-left text-base font-medium transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${q1 === v ? "border-forest bg-forest/10 text-forest" : "border-line bg-cream text-ink"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={skip}
                    className="mt-4 min-h-11 text-base font-semibold text-forest underline"
                  >
                    Not sure? Just show me the offer →
                  </button>
                </>
              )}

              {step === 1 && (
                <>
                  <button type="button" onClick={back} className="inline-flex min-h-11 items-center text-base font-semibold text-forest">
                    <IconArrowLeft className="h-5 w-5" /> Back
                  </button>
                  <h2 className="mt-1 font-display text-2xl font-semibold leading-tight text-forest">
                    What's the hardest part right now?
                  </h2>
                  <div className="mt-4 flex flex-col gap-2.5">
                    {Q2_CHIPS.map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => answer(2, v)}
                        className={`min-h-[3.25rem] w-full rounded-2xl border px-4 text-left text-base font-medium transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${q2 === v ? "border-forest bg-forest/10 text-forest" : "border-line bg-cream text-ink"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 2 && (
                <>
                  <button type="button" onClick={back} className="inline-flex min-h-11 items-center text-base font-semibold text-forest">
                    <IconArrowLeft className="h-5 w-5" /> Back
                  </button>
                  <h2 className="mt-1 font-display text-2xl font-semibold leading-tight text-forest">
                    What would help most right now?
                  </h2>
                  <div className="mt-4 grid grid-cols-2 gap-2.5">
                    {Q3_CHIPS.map(([v, l]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => answer(3, v)}
                        className={`min-h-[3.25rem] w-full rounded-2xl border px-4 text-left text-base font-medium transition-colors hover:border-forest/30 hover:bg-cream-deep active:scale-[0.98] ${q3 === v ? "border-forest bg-forest/10 text-forest" : "border-line bg-cream text-ink"}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {step === 3 && (
                <>
                  {!skipped && mirrorLine && (
                    <p className="text-base text-stone">{mirrorLine}</p>
                  )}
                  <div className="mt-3 rounded-3xl border-2 border-forest bg-card p-6">
                    {skipped ? (
                      <>
                        <h3 className="font-display text-xl font-semibold text-forest">
                          Every plan, half price for 3 months.
                        </h3>
                        <p className="mt-2 text-base leading-relaxed text-stone">
                          Steady $2.49/mo ×3 · Command Center $6.24/mo ×3 · Ultimate $12.49/mo ×3.
                          Then standard rates. Cancel anytime.
                        </p>
                      </>
                    ) : rec ? (
                      <>
                        <h3 className="font-display text-xl font-semibold text-forest">{planName(rec.plan)}</h3>
                        <p className="mt-2 text-base leading-relaxed text-stone">{rec.why}</p>
                        <p className="mt-3 text-base font-semibold text-ink">{rec.price}</p>
                      </>
                    ) : null}
                    <p className="mt-3 text-xs leading-relaxed text-stone">
                      {rec?.plan === "consultation"
                        ? "Real price: $39.50 → $19.75 today. No subscription. No countdown."
                        : "Real math. The 50% lasts your full first 3 months — no countdown. Cancel anytime."}
                    </p>
                    {skipped ? (
                      <a href="/pricing?checkin=50" className="btn-primary mt-4 block w-full text-center">
                        See plans at 50% off →
                      </a>
                    ) : rec ? (
                      <button type="button" onClick={cta} disabled={busy} className="btn-primary mt-4 w-full">
                        {busy ? "Opening checkout…" : rec.cta}
                      </button>
                    ) : null}
                    {!skipped && rec && rec.secondary && (
                      <p className="mt-2 text-center text-sm text-stone">{rec.secondary}</p>
                    )}
                  </div>
                  <a href="/pricing?checkin=50" className="mt-4 block min-h-11 text-center text-base font-semibold text-forest underline">
                    See all plans →
                  </a>
                  <button type="button" onClick={dismiss} className="mt-1 min-h-11 w-full text-base font-semibold text-forest">
                    Keep my free review
                  </button>
                </>
              )}
            </div>

            <p className="mt-4 text-xs text-taupe">Communication guidance, not legal advice.</p>
            {msg && (
              <p role="status" className="mt-3 rounded-xl bg-cream-deep p-3 text-sm text-stone">
                {msg}
              </p>
            )}
        {needLogin && (
          <a href={`/login?next=${encodeURIComponent(pathname + window.location.search)}`} className="btn-primary mt-3 block w-full text-center">
            Sign in to continue
          </a>
        )}
          </div>
        </div>
      )}
    </>
  );
}
