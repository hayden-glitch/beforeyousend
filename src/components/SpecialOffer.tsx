import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { track } from "~/lib/analytics";
import {
  offerQualified,
  offerAccepted,
  offerShownThisSession,
  markOfferShown,
  markOfferAccepted,
  purchasedThisSession,
  suppressForPath,
  valueDelivered,
} from "~/lib/offer";
import { modalOpen, claimModal, releaseModal } from "~/lib/trial";
import { consultationMoney } from "~/lib/prices";
import { runCheckout } from "~/lib/checkout";
import { IconCheck, IconClose } from "~/components/icons";

// Global special-offer bottom sheet (mobile) / slide-in card (desktop).
// Honest mechanics: appears once per session, ~4.5s after the user has engaged
// >= 2 distinct surfaces; no countdowns, no fake scarcity — the 3-month intro
// term is the mechanism and the copy says so plainly.

// The Ultimate-user suppression flag is fetched once per page load and cached
// at module scope — the modal must not re-hit /api/auth/me on every route
// change (it used to, doubling the auth traffic per navigation).
let mePromise: Promise<boolean> | null = null;
function isUltimateUser(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  mePromise ||= fetch("/api/auth/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((j) => j.user?.profile?.tier === "ultimate")
    .catch(() => false);
  return mePromise;
}

export default function SpecialOffer() {
  const { pathname } = useLocation();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [isUltimate, setIsUltimate] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  // Refresh the Ultimate-user suppression flag on mount (cached after the
  // first fetch — no per-route-change auth traffic).
  useEffect(() => {
    let alive = true;
    isUltimateUser().then((u) => {
      if (alive) setIsUltimate(u);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Value gate (owner 2026-08-10): the offer must never appear before the
  // visitor has gotten the free value — no surfaces before a review completes
  // (or the Check-In completes) this session. Session-scoped, honest.
  // Evaluated LIVE at arm/fire time (sessionStorage reads inside the callback)
  // so late value delivery still counts; never stale-closed over a re-render.
  const gated = useCallback(
    () =>
      suppressForPath(pathname) ||
      isUltimate ||
      offerAccepted() ||
      purchasedThisSession() ||
      !valueDelivered() ||
      // One modal at a time (owner 2026-08-13): while the 24-hour-trial modal
      // is up, the offer defers. The trial wins on /pricing by firing first
      // (2s vs 4.5s); on shared pages the first-qualified modal wins and the
      // other waits. They can never stack.
      modalOpen(),
    [pathname, isUltimate]
  );

  // Auto-appear after the qualification delay (once per session). The timer is
  // armed on mount/path change AND re-armed on every surface record
  // (bys:surface, dispatched by recordSurface) — so a route's recordSurface
  // call can never be missed regardless of React effect ordering between the
  // route component and this modal. Qualification (offerQualified) and the
  // value gate are checked at FIRE time, not arm time.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (show || gated() || offerShownThisSession()) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (!gated() && !offerShownThisSession() && offerQualified()) {
          setShow(true);
          claimModal();
          markOfferShown();
          track("special_offer_shown", {});
        }
      }, 4500);
    };
    arm();
    window.addEventListener("bys:surface", arm);
    return () => {
      window.removeEventListener("bys:surface", arm);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, show, isUltimate, gated]);

  // The pricing echo banner ("Comparing plans? …") requests the offer directly.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const open = () => {
      if (offerAccepted() || purchasedThisSession() || isUltimate || !valueDelivered() || modalOpen()) return;
      setShow(true);
      claimModal();
      markOfferShown();
      track("special_offer_shown", { source: "echo_banner" });
    };
    window.addEventListener("bys:offer", open);
    return () => window.removeEventListener("bys:offer", open);
  }, [isUltimate]);

  const dismiss = useCallback(() => {
    setShow(false);
    releaseModal();
    track("special_offer_dismissed", {});
  }, []);

  // Mark accepted ONLY once a purchase is actually confirmed (pricing's
  // checkout-return handler dispatches this). A declined/abandoned checkout
  // must not kill the intro offer for the browser.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAccepted = () => {
      markOfferAccepted();
      setShow(false);
      releaseModal();
    };
    window.addEventListener("bys:offer-accepted", onAccepted);
    return () => window.removeEventListener("bys:offer-accepted", onAccepted);
  }, []);

  // Dialog focus management: focus the panel on open, trap Tab inside it,
  // close on Escape, lock body scroll, restore focus on close.
  useEffect(() => {
    if (!show) return;
    lastFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dismiss();
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
  }, [show, dismiss]);

  const accept = useCallback(async () => {
    track("special_offer_accepted", {});
    setBusy(true);
    setMsg("");
    // Shared coordinator: auth-first. A signed-out dad gets the offer intent
    // parked + an immediate /login?next=<this page> hop (the modal never
    // silently 401s behind an off-screen link); the __root resumer re-runs
    // this exact offer checkout after sign-in.
    const outcome = await runCheckout({
      plan: "ultimate",
      interval: "month",
      source: "special_offer",
      offer: true,
      setBusy,
      onError: (m) => setMsg(m || "Checkout is not available right now."),
    });
    if (outcome.state === "opening" && outcome.url) location.href = outcome.url;
  }, []);

  if (!show) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Launch offer — Ultimate Co-Parent">
      <button
        type="button"
        aria-label="Close offer"
        onClick={dismiss}
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
            For dads who are still deciding
          </p>
          <button
            type="button"
            onClick={dismiss}
            className="icon-btn min-h-11 text-stone"
            aria-label="Close"
          >
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <h2 className="mt-2 font-display text-2xl font-semibold leading-tight text-forest">
          The whole system, one plan.
        </h2>
        <p className="mt-2 text-base leading-relaxed text-stone">
          Ultimate Co-Parent — everything we offer — $19.99/mo for your first 3 months, then $24.99/mo. Cancel anytime.
        </p>
        <ul className="mt-4 space-y-2 text-base leading-relaxed text-ink">
          <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-forest-soft" /><span>1 free consultation a year ({consultationMoney} value)</span></li>
          <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-forest-soft" /><span>All one-time packs included — Review Top-Ups, Attorney Prep Pack, Record Review, Document Sort</span></li>
          <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-forest-soft" /><span>Kickstart setup — we'll help you get your situation and your first entries into your record</span></li>
          <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-forest-soft" /><span>Priority scheduling + priority support</span></li>
        </ul>
        <button type="button" onClick={accept} disabled={busy} className="btn-primary mt-5 w-full">
          {busy ? "Opening checkout…" : "Start the full system — $19.99/mo × 3"}
        </button>
        <button type="button" onClick={dismiss} className="mt-2 min-h-11 w-full text-base font-semibold text-forest underline">
          No thanks — I'm still deciding
        </button>
        <p className="mt-3 text-xs leading-relaxed text-stone">
          Real launch price, time-boxed by the plan — no countdown. Cancel anytime from your account.
        </p>
        <p className="mt-2 text-xs text-taupe">Communication guidance, not legal advice.</p>
        {msg && (
          <p role="status" className="mt-3 rounded-xl bg-cream-deep p-3 text-sm text-stone">
            {msg}
          </p>
        )}
      </div>
    </div>
  );
}
