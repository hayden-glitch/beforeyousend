// ─────────────────────────────────────────────────────────────────────────────
// BYS-NATIVE PAYMENT SURFACE (checkout-reliability rebuild, slice 2b)
// The branded in-app payment step. Rendered by a checkout caller when the
// coordinator's runCheckout returns opening + mode:"custom" and
// paymentSurfaceAvailable() is true (test-mode server + VITE_STRIPE_PUBLISHABLE_KEY).
//
// Surface choice: Stripe Payment Element (not Express Checkout Element).
// Why: the Express Checkout Element renders WALLET BUTTONS ONLY (no card form)
// and in custom Checkout it requires an account-level payment method
// configuration / Apple-Pay merchant-domain verification the owner's account
// does not yet have — without those it fires loaderror and shows nothing. The
// Payment Element is the actual "branded card UI": it renders the card form
// inline (works for every dad, wallet or no wallet), auto-shows Apple
// Pay/Google Pay/Link where the account is eligible, needs zero extra account
// config in custom Checkout, and fits the mobile-first single-column layout.
//
// Fallback contract (automatic, never strands the user):
//   - no publishable key / no clientSecret / no returnUrl → hosted url redirect
//   - Stripe.js fails to load / elements fails / element loaderror → hosted url
//   - confirmPayment returns a redirect_to_url error → follow it
//   - confirmPayment returns a real payment error (declined etc.) → show the
//     Stripe message inline + keep the always-visible "continue on Stripe's
//     secure page" escape (an infra failure auto-redirects; a card decline is
//     actionable in place — yanking a dad mid-entry to another domain is the
//     opposite of calm, so the escape is one tap, not a page throw).
//   - hosted url missing entirely (should not happen) → onError + onClose.
//
// Success: confirmPayment redirects to returnUrl (the SAME
// checkout=success&session_id= URL the hosted flow uses), so the existing
// capture → scrub → /api/checkout/confirm → webhook grant path is shared
// byte-for-byte. No new grant logic lives here.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Stripe, StripeElements, StripePaymentElement } from "@stripe/stripe-js";
import type { CheckoutOpening } from "~/lib/checkout";

const ONE_TIME_PLANS = new Set([
  "topup", "sortpile", "attorney_prep_pack", "record_review", "consultation", "gift",
]);
const PLAN_NAMES: Record<string, string> = {
  steady: "Steady",
  command: "Command Center",
  ultimate: "Ultimate Co-Parent",
  topup: "Review Top-Up",
  sortpile: "Sort My Pile",
  attorney_prep_pack: "Attorney Prep Pack",
  record_review: "Record Review",
  consultation: "One Conversation",
  gift: "Gift a Month",
};

type Props = {
  outcome: CheckoutOpening;
  /** Close the surface — the dad is back on the page he was on; nothing was
   *  charged and the abandoned session expires on Stripe's side. */
  onClose: () => void;
  /** Surface-adjacent error slot (only used when even the hosted url is gone). */
  onError?: (message: string) => void;
};

function SheetFrame({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
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
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[36]" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bys-sheet absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl border-t border-forest bg-card px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:rounded-2xl sm:border"
      >
        <div className="bys-grabber" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

export default function PaymentSurface({ outcome, onClose, onError }: Props) {
  const elementRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready">("loading");
  const [formComplete, setFormComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [payError, setPayError] = useState("");

  // Automatic hosted fallback — the universal escape. window.location.href so
  // the dad lands on the branded Stripe page with the SAME session (nothing to
  // redo). Guarded: only used when the surface genuinely cannot function.
  const fallbackToHosted = useCallback(() => {
    const url = outcome.url;
    if (url) {
      try {
        window.location.href = url;
        return;
      } catch {
        /* fall through to onError */
      }
    }
    onError?.("Checkout is not available right now. Nothing was charged.");
    onClose();
  }, [outcome.url, onClose, onError]);

  useEffect(() => {
    let cancelled = false;
    let paymentEl: StripePaymentElement | null = null;

    async function init() {
      const pk = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim();
      if (!pk || !outcome.clientSecret || !outcome.returnUrl) {
        // Server said custom but the client can't render it — hosted, now.
        if (!cancelled) fallbackToHosted();
        return;
      }
      try {
        const mod = await import("@stripe/stripe-js");
        // loadStripe injects js.stripe.com; cap the wait so a blocked CDN or a
        // hung handshake degrades to the hosted page instead of spinning.
        const stripe: Stripe | null = await Promise.race([
          mod.loadStripe(pk),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 12000)),
        ]);
        if (cancelled) return;
        if (!stripe) {
          fallbackToHosted();
          return;
        }
        stripeRef.current = stripe;
        const elements = stripe.elements({ clientSecret: outcome.clientSecret });
        elementsRef.current = elements;
        paymentEl = elements.create("payment", { layout: { type: "tabs" } });
        paymentEl.on("loaderror", () => {
          if (!cancelled) fallbackToHosted();
        });
        paymentEl.on("change", (e) => {
          if (!cancelled) setFormComplete(e.complete === true);
        });
        if (!cancelled && elementRef.current) {
          paymentEl.mount(elementRef.current);
          setPhase("ready");
        } else if (!cancelled) {
          fallbackToHosted();
        }
      } catch {
        if (!cancelled) fallbackToHosted();
      }
    }
    init();
    return () => {
      cancelled = true;
      try {
        paymentEl?.unmount?.();
        paymentEl?.destroy?.();
      } catch {
        /* element already gone */
      }
    };
  }, [outcome, fallbackToHosted]);

  async function pay() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setPayError("");
    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: outcome.returnUrl || outcome.url },
      });
      if (error) {
        // confirmPayment was called WITHOUT redirect:"if_required", so Stripe.js
        // itself performs the redirect to return_url on success (and through
        // any 3DS step). An error here is a real payment failure (declined,
        // expired, etc.) — show it inline; the always-visible hosted fallback
        // button below remains the one-tap escape.
        setSubmitting(false);
        setPayError(error.message || "We couldn't complete that payment. Please try again.");
        return;
      }
      // No error and no redirect returned — session completed in place; the
      // confirm flow on the return page owns the grant, so just reload.
      if (outcome.returnUrl) window.location.href = outcome.returnUrl;
    } catch {
      setSubmitting(false);
      setPayError("We couldn't complete that payment. Please try again.");
    }
  }

  const oneTime = ONE_TIME_PLANS.has(outcome.plan);
  const name = PLAN_NAMES[outcome.plan] || "Your purchase";

  return (
    <SheetFrame onClose={onClose} label={`Checkout — ${name}`}>
      <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-taupe">One step left</p>
      <h2 className="mt-1 font-display text-2xl font-semibold text-ink">{name}</h2>
      <p className="mt-2 text-sm leading-relaxed text-stone">
        {oneTime
          ? "One-time purchase — nothing renews."
          : "Cancel anytime — access continues through the paid period."}
      </p>

      <div className="mt-5">
        {phase === "loading" && (
          <p className="py-6 text-center text-sm text-taupe">Preparing secure payment…</p>
        )}
        {phase === "ready" && (
          <>
            <div ref={elementRef} className="w-full" />
            {payError && (
              <p role="alert" className="mt-3 rounded-[10px] border border-line bg-cream px-3 py-2 text-sm text-stone">
                {payError}
              </p>
            )}
            <button
              type="button"
              onClick={pay}
              disabled={!formComplete || submitting}
              className="btn-primary mt-5 min-h-12 w-full text-base disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Processing…" : oneTime ? "Pay now" : "Start my plan"}
            </button>
            <p className="mt-3 text-center text-xs leading-relaxed text-taupe">
              Secure checkout by Stripe. Your card details never touch Before You Send.
            </p>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={fallbackToHosted}
        className="mt-4 min-h-11 w-full text-center text-sm font-semibold text-stone underline-offset-4 hover:text-ink hover:underline"
      >
        Continue on Stripe's secure page instead
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 min-h-11 w-full text-center text-base font-semibold text-stone underline-offset-4 hover:text-ink hover:underline"
      >
        Back
      </button>
    </SheetFrame>
  );
}
