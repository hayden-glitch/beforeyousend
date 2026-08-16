import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import { valueDelivered } from "~/lib/offer";
import {
  trialDismissed,
  markTrialDismissed,
  setTrialIntent,
  modalOpen,
  claimModal,
  releaseModal,
  payBrand,
  loginIntakeActive,
  type PayBrand,
  trialOpenPending,
  setTrialOpenPending,
  clearTrialOpenPending,
} from "~/lib/trial";
import { IconClose } from "~/components/icons";

// 24-hour free trial modal (owner direction 2026-08-13; GPT cleanup
// 2026-08-16). Short, kind, direct: a dad dwelling on a high-intent page
// (10s) gets one quiet offer of a REAL free 24 hours — the full paid
// experience, no card, no catch, one per person ever. On /pricing the SAME
// offer is an explicit inline action (never an automatic modal over the
// comparison — see pricing.tsx openTrial / the bys:open-trial listener
// below). Never on /quiz /confirm /onboarding /owner /verification /redeem;
// never for paid users, active-trial users, prior-trial users, or anyone who
// dismissed (30-day cookie). Mutually exclusive with the Special Offer
// (shared window lock — one modal at a time). Device-aware pay row: the
// visitor's OWN phone's tap-to-pay mark (Apple Pay on iOS, Google Pay on
// Android) is a little more prominent, the main cards small beside it —
// desktop gets a plain card row. No urgency words anywhere; the trial is real.

const TRIAL_FAST = "/pricing";
const TRIAL_SLOW = ["/", "/faq", "/about", "/consultations", "/login", "/contact", "/trust"];
const TRIAL_NEVER = ["/quiz", "/confirm", "/onboarding", "/owner", "/verification", "/redeem"];
const SHOWN_KEY = "bys_trial_shown";

function trialShownThisSession(): boolean {
  try {
    return !!sessionStorage.getItem(SHOWN_KEY);
  } catch {
    return false;
  }
}
function markTrialShown(): void {
  try {
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    /* noop */
  }
}

// Auth status fetched once per page load and cached at module scope (mirrors
// SpecialOffer's isUltimateUser — no per-route-change auth traffic).
let mePromise: Promise<{ eligible: boolean; signedIn: boolean }> | null = null;
function authStatus(): Promise<{ eligible: boolean; signedIn: boolean }> {
  if (typeof window === "undefined") return Promise.resolve({ eligible: false, signedIn: false });
  mePromise ||= fetch("/api/auth/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((j) => {
      const signedIn = !!j.user;
      // Anonymous visitors are eligible (Yes routes to the free account).
      // Signed-in: only free-tier accounts with NO prior trial (active or
      // spent) see the offer; paid/active-trial/used-trial never do.
      const eligible = !signedIn || (j.quota?.tier === "free" && !j.trial?.used);
      return { eligible, signedIn };
    })
    // P1 fix (2026-08-16): a failed one-shot fetch must NOT poison the
    // singleton for the rest of the page session — clear it so the next
    // authStatus() call retries (explicit-open path uses authStatusFresh).
    .catch(() => {
      mePromise = null;
      return { eligible: false, signedIn: false };
    });
  return mePromise;
}
// One-shot fresh eligibility read for the explicit open path — NEVER cached.
// /api/auth/me can take 400-1000ms on a cold serverless start; the mount-time
// read may still be null (or stale-false after a hiccup) when a visitor taps
// the pricing trial CTA, and the old guard silently swallowed those taps
// (live QA P1: click → 0 dialogs at 390px). The explicit request deserves a
// fresh read; the real eligibility rules are unchanged (server re-checks on
// /api/trial/start anyway).
function authStatusFresh(): Promise<{ eligible: boolean; signedIn: boolean }> {
  return fetch("/api/auth/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((j) => {
      const signedIn = !!j.user;
      return { eligible: !signedIn || (j.quota?.tier === "free" && !j.trial?.used), signedIn };
    })
    .catch(() => ({ eligible: false, signedIn: false }));
}

// ---- Payment marks (clean inline SVG/text, no external assets) ----
function AppleMark({ prominent }: { prominent?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-[#1d1d1f] text-cream ${
        prominent ? "h-8 px-3" : "h-6 px-2"
      }`}
      aria-label="Apple Pay"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <path d="M17.05 12.53c-.03-2.74 2.24-4.06 2.34-4.12-1.27-1.86-3.25-2.12-3.95-2.15-1.68-.17-3.29.99-4.14.99-.85 0-2.17-.97-3.56-.94-1.83.03-3.52 1.06-4.46 2.7-1.9 3.3-.49 8.19 1.37 10.87.91 1.31 1.99 2.78 3.41 2.73 1.37-.05 1.89-.88 3.54-.88 1.66 0 2.12.88 3.57.85 1.47-.02 2.41-1.34 3.31-2.66 1.04-1.52 1.47-3 1.5-3.07-.03-.02-2.87-1.1-2.9-4.32zM14.36 4.39c.75-.91 1.26-2.18 1.12-3.44-1.08.04-2.39.72-3.17 1.63-.7.81-1.31 2.1-1.15 3.34 1.21.09 2.45-.61 3.2-1.53z" />
      </svg>
      <span className="text-[11px] font-semibold tracking-tight">Pay</span>
    </span>
  );
}
function GoogleMark({ prominent }: { prominent?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center gap-1 rounded-md border border-line bg-card ${
        prominent ? "h-8 px-3" : "h-6 px-2"
      }`}
      aria-label="Google Pay"
    >
      <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.6 39.6 16.3 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 40.3 44 34.8 44 24c0-1.3-.1-2.6-.4-3.9z" />
      </svg>
      <span className="text-[11px] font-semibold tracking-tight text-[#4285F4]">Pay</span>
    </span>
  );
}
function VisaMark() {
  return (
    <span aria-label="Visa" className="inline-flex h-6 shrink-0 items-center rounded-sm bg-white px-1.5 text-[10px] font-extrabold italic tracking-tighter text-[#1A1F71] ring-1 ring-line">
      VISA
    </span>
  );
}
function MastercardMark() {
  return (
    <span aria-label="Mastercard" className="relative inline-flex h-6 w-9 shrink-0 items-center justify-center">
      <span className="absolute left-0 h-4 w-4 rounded-full bg-[#EB001B]" aria-hidden="true" />
      <span className="absolute right-0 h-4 w-4 rounded-full bg-[#F79E1B]" aria-hidden="true" />
      <span className="absolute left-[14px] h-4 w-4 rounded-full bg-[#FF5F00]/60" aria-hidden="true" />
      <span className="sr-only">Mastercard</span>
    </span>
  );
}
function AmexMark() {
  return (
    <span aria-label="American Express" className="inline-flex h-6 shrink-0 items-center justify-center rounded-sm bg-[#2E77BC] px-1.5 text-[9px] font-bold tracking-tight text-white">
      AMEX
    </span>
  );
}
function DiscoverMark() {
  return (
    <span aria-label="Discover" className="inline-flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F48120] px-2 text-[8px] font-bold tracking-tighter text-white">
      DISCOVER
    </span>
  );
}

function PayRow({ brand }: { brand: PayBrand }) {
  if (brand === "apple") {
    return (
      <div className="flex items-center gap-2">
        <AppleMark prominent />
        <VisaMark />
        <MastercardMark />
        <AmexMark />
        <DiscoverMark />
      </div>
    );
  }
  if (brand === "google") {
    return (
      <div className="flex items-center gap-2">
        <GoogleMark prominent />
        <VisaMark />
        <MastercardMark />
        <AmexMark />
        <DiscoverMark />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <VisaMark />
      <MastercardMark />
      <AmexMark />
      <DiscoverMark />
    </div>
  );
}

export default function TrialModal() {
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState("");
  const [auth, setAuth] = useState<{ eligible: boolean; signedIn: boolean } | null>(null);
  const [brand] = useState<PayBrand>(() => payBrand());
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // Refresh auth once on mount (cached — no per-route-change traffic).
  useEffect(() => {
    let alive = true;
    authStatus().then((a) => {
      if (alive) setAuth(a);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Defer rule: if the Special Offer is up (shared window lock), the trial
  // waits; the offer's own gate defers while the trial is up. Never two at once.
  // /login with the 3-question intake showing is deferred too (owner
  // 2026-08-13): the intake IS the engagement; the trial starts quietly at
  // account confirm for anyone who carried intent.
  // Value gate (conversion-cycle-1, owner 2026-08-13): on / and /login the
  // offer never fires before a review completes in this session — the reward
  // lands first, the ask comes after (mirrors SpecialOffer's value gate).
  // /pricing was EXEMPT by owner decision (2026-08-13) with a fast ~2s idle
  // trigger; GPT cleanup (2026-08-16): that automatic 2s modal is GONE — the
  // pricing offer is now an explicit inline action (bys:open-trial below),
  // so the value-gate lines below only matter for the remaining auto-dwell
  // paths. Read FRESH at fire time from sessionStorage, so a late delivery
  // still un-gates / and /login.
  const gated = useCallback(
    () =>
      TRIAL_NEVER.includes(pathname) ||
      (pathname !== TRIAL_FAST && !TRIAL_SLOW.includes(pathname)) ||
      (pathname === "/login" && loginIntakeActive()) ||
      modalOpen() ||
      trialShownThisSession() ||
      trialDismissed() ||
      (pathname !== TRIAL_FAST && !valueDelivered()) ||
      auth === null ||
      !auth.eligible,
    [pathname, auth]
  );

  // Dwell timer: high-intent pages after ~10s. /pricing is deliberately NOT
  // armed — GPT cleanup (2026-08-16): the trial offer there is an explicit
  // inline action, never an automatic modal over the plan comparison. Re-armed
  // on path change AND on value delivery (bys:checkin-value, dispatched by
  // ReviewTool/home right after markValueDelivered) — a visitor who lands
  // before reviewing must still get the offer after their first review, not
  // miss it because the pre-value arm already elapsed. Gating is re-checked at
  // FIRE time, never stale.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [valueAt, setValueAt] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (show || gated()) return;
      if (pathname === TRIAL_FAST) return; // explicit inline action only on pricing
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!gated()) {
          setShow(true);
          claimModal();
          markTrialShown();
          track("trial_modal_shown", { path: pathname });
        }
      }, 10000);
    };
    // Named handler so cleanup removes the SAME listener (Codex finding
    // 2026-08-13: add/remove used two different anonymous fns, so the cleanup
    // never detached anything and the listener leaked on every pathname/show/
    // auth change). Same named-handler pattern as CoParentCheckIn.tsx.
    const onCheckinValue = () => setValueAt((v) => v + 1);
    arm();
    window.addEventListener("bys:checkin-value", onCheckinValue);
    return () => {
      window.removeEventListener("bys:checkin-value", onCheckinValue);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, show, auth, gated, valueAt]);

  // GPT cleanup (2026-08-16): explicit-open path — pricing's inline
  // `Free 24 hours · no card` button dispatches bys:open-trial. This is a
  // DELIBERATE user action, so it does NOT count against the once-per-session
  // flag and is not value-gated: if the visitor just closed the sheet they may
  // choose to open it again. The real eligibility rules are unchanged and are
  // enforced here (one trial per person ever, 30-day dismiss, paid users,
  // active-trial users, and never while another dialog holds the lock).
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const tryOpen = (a: { eligible: boolean; signedIn: boolean } | null) => {
      if (cancelled || show || trialDismissed() || a === null || !a.eligible) return;
      // One modal at a time: if another dialog is genuinely up, defer. If the
      // lock is merely stale (no dialog in the DOM — e.g. a modal unmounted
      // without releasing), the explicit user action wins.
      if (modalOpen()) {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
        releaseModal();
      }
      setShow(true);
      claimModal();
      markTrialShown();
      track("trial_modal_shown", { path: pathname, source: "pricing_inline" });
    };
    const onOpenRequest = () => {
      clearTrialOpenPending();
      if (auth !== null && auth.eligible) {
        tryOpen(auth);
      } else {
        // Mount-time auth is missing or stale-negative (slow one-shot fetch /
        // failed cold start). Read eligibility NOW — honest, real rules.
        authStatusFresh().then((a) => {
          if (cancelled) return;
          setAuth(a);
          tryOpen(a);
        });
      }
    };
    window.addEventListener("bys:open-trial", onOpenRequest);
    return () => {
      cancelled = true;
      window.removeEventListener("bys:open-trial", onOpenRequest);
    };
  }, [show, auth, pathname]);
  // P1 fix (2026-08-16): honor a trial-open request that arrived before this
  // lazily-deferred chunk finished mounting (DeferredMount caps at 6s — a fast
  // mobile tap on the pricing CTA races the chunk fetch and the CustomEvent is
  // lost). pricing.tsx sets the session flag before dispatching; if the event
  // missed the listener above, the flag is still set — open here with the same
  // guards (and only on /pricing, the only surface that sets it).
  useEffect(() => {
    if (auth === null || !trialOpenPending()) return;
    clearTrialOpenPending();
    if (show || trialDismissed() || !auth.eligible) return;
    if (pathname !== TRIAL_FAST) return;
    if (modalOpen() && document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
    if (modalOpen()) releaseModal();
    setShow(true);
    claimModal();
    markTrialShown();
    track("trial_modal_shown", { path: pathname, source: "pricing_inline" });
  }, [auth, show, pathname]);

  // Release the shared lock when the modal closes for ANY reason.
  useEffect(() => {
    if (!show) releaseModal();
  }, [show]);

  const close = useCallback((dismissFor30d: boolean) => {
    if (dismissFor30d) markTrialDismissed();
    setShow(false);
    releaseModal();
  }, []);

  // Focus management + body scroll lock (same pattern as SpecialOffer).
  useEffect(() => {
    if (!show) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(false);
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
  }, [show, close]);

  async function accept() {
    track("trial_modal_yes", {});
    // Anonymous: carry intent through the calm email capture (email → confirm
    // → password → onboarding); the moment the account is confirmed the client
    // auto-starts the trial (maybeStartTrial in /confirm + /home fallback).
    if (auth === null || !auth.signedIn) {
      setTrialIntent();
      window.location.assign("/login");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/trial/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ source: "trial_modal" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        track("trial_started", {});
        setDone(true);
        setShow(false);
        releaseModal();
        return;
      }
      setMsg(typeof d?.error === "string" ? d.error : "Could not start your trial right now — please try again.");
    } catch {
      setMsg("Could not start your trial right now — please try again.");
    }
    setBusy(false);
  }

  function decline() {
    track("trial_modal_no", {});
    close(true);
  }

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Free 24-hour trial">
      <button
        type="button"
        aria-label="Close"
        onClick={() => close(false)}
        className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bys-sheet absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[14px] border-t border-line bg-card p-6 shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:rounded-[14px] sm:border"
      >
        <div className="bys-grabber" aria-hidden="true" />
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">
            A free 24 hours
          </p>
          <button
            type="button"
            onClick={() => close(false)}
            className="icon-btn min-h-11 text-stone"
            aria-label="Close"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-forest">
          A free 24 hours of Before You Send.
        </h2>
        <p className="mt-2 text-base leading-relaxed text-stone">
          The full experience, free for one day. No card, no catch.
        </p>
        <div className="mt-4 rounded-xl border border-line bg-cream-deep/60 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-forest-soft">
            Everything, unlocked for one day
          </p>
          <ul className="mt-1.5 space-y-1 text-sm leading-relaxed text-stone">
            <li>Unlimited message reviews + situation analyses</li>
            <li>Photos &amp; documents on reviews</li>
            <li>The Organizer, Case Summary &amp; Action Center</li>
          </ul>
          <div className="mt-3 border-t border-line/70 pt-3">
            <PayRow brand={brand} />
            <p className="mt-2 text-xs text-taupe">
              No card now. It stays free after — you just keep the trial version of your plan.
            </p>
          </div>
        </div>
        <button type="button" onClick={accept} disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? "Starting…" : "Yes, try it free"}
        </button>
        <button type="button" onClick={decline} className="mt-2 min-h-11 w-full text-base font-semibold text-forest underline">
          No thanks
        </button>
        <p className="mt-3 text-xs leading-relaxed text-stone">
          One free trial per person. When the 24 hours are up, your account goes back to Free — your
          saved work stays.
        </p>
        {done && (
          <p role="status" className="mt-3 rounded-xl bg-cream-deep p-3 text-sm font-semibold text-forest">
            Your 24 hours are on. Enjoy the full experience.
          </p>
        )}
        {msg && (
          <p role="status" className="mt-3 rounded-xl bg-cream-deep p-3 text-sm text-stone">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
