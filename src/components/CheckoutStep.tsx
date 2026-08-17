import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Stripe, StripeExpressCheckoutElement } from "@stripe/stripe-js";
import { track } from "~/lib/analytics";

// One focused checkout step (smooth-payment preview slice): the dad picked a
// plan or product on the pricing page; this sheet shows ONE calm step —
// selected item with exact price + terms, wallet buttons via Stripe's Express
// Checkout Element (Stripe decides eligibility — we never render fake wallet
// buttons), a quiet "or pay by card" separator, and the hosted-Checkout card
// fallback that already exists. If Stripe.js can't initialize (no publishable
// key / unsupported browser / custom session unavailable), the wallet area is
// simply absent and the card path is the primary action — the current hosted
// Checkout stays the fallback everywhere.

const ONE_TIME_PLANS = new Set(["topup", "consultation", "gift", "sortpile", "attorney_prep_pack", "record_review"]);

export type CheckoutStepItem = {
  plan: string;
  interval: "month" | "year";
  name: string;
  priceLabel: string;
  terms: string;
  /** Ultimate launch-intro flag — sent to the server exactly like /api/checkout. */
  offer?: boolean;
  /** Check-In coupon flag — sent to the server exactly like /api/checkout. */
  checkin?: boolean;
};

type Props = {
  open: boolean;
  item: CheckoutStepItem | null;
  onClose: () => void;
  /** The current hosted Checkout path — unchanged, and the fallback for card. */
  onCard: (plan: string, interval: "month" | "year") => void;
  /** 401 from the custom endpoint → parent shows the same ?next= login prompt. */
  onAuthRequired?: (msg: string) => void;
};

// Shared sheet chrome (same bys-sheet pattern as AttachControl / SpecialOffer /
// CoParentCheckIn): mobile bottom sheet + right-anchored card on desktop, focus
// management, Escape to close, scroll lock, focus restore on close.
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

export default function CheckoutStep({ open, item, onClose, onCard, onAuthRequired }: Props) {
  const walletRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "card">("loading");

  useEffect(() => {
    if (!open || !item) return;
    // Capture the narrowed item — TS resets narrowing inside the async closure.
    const cur = item;
    let cancelled = false;
    let ece: StripeExpressCheckoutElement | null = null;
    setState("loading");
    async function init() {
      // Publishable key comes ONLY from the build environment. Never hardcode.
      const pk = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim();
      if (!pk) {
        // No key → no Stripe.js, no wallets. The card/hosted path is primary.
        if (!cancelled) setState("card");
        return;
      }
      try {
        const res = await fetch("/api/checkout/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan: cur.plan,
            interval: cur.interval,
            offer: cur.offer === true,
            checkin: cur.checkin === true,
          }),
        });
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 401 || d.login_required) {
            onAuthRequired?.(d.error || "Sign in to start checkout — your purchase is linked to your account.");
            onClose();
            return;
          }
          // 503 guard / test-mode-unavailable / any refusal → hosted fallback.
          setState("card");
          return;
        }
        if (!d.client_secret || !d.return_url) {
          setState("card");
          return;
        }
        const mod = await import("@stripe/stripe-js");
        const stripe: Stripe | null = await mod.loadStripe(pk);
        if (cancelled || !stripe) {
          setState("card");
          return;
        }
        const elements = stripe.elements({ clientSecret: d.client_secret });
        ece = elements.create("expressCheckout");
        ece.on("ready", () => {
          if (!cancelled) setState("ready");
        });
        ece.on("loaderror", () => {
          if (!cancelled) setState("card");
        });
        ece.on("confirm", async (event) => {
          // Same funnel vocabulary as the hosted path — fired only when the dad
          // actually confirms a wallet payment (plan/interval identifiers only).
          track("checkout_started", { plan: cur.plan, interval: cur.interval });
          try {
            const { error } = await stripe.confirmPayment({
              elements,
              confirmParams: { return_url: d.return_url },
            });
            if (error) event.paymentFailed({ reason: "fail", message: error.message || undefined });
          } catch {
            event.paymentFailed({ reason: "fail" });
          }
        });
        if (!cancelled && walletRef.current) ece.mount(walletRef.current);
      } catch {
        if (!cancelled) setState("card");
      }
    }
    init();
    return () => {
      cancelled = true;
      try {
        ece?.unmount?.();
        ece?.destroy?.();
      } catch {
        /* element already gone */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item]);

  if (!open || !item) return null;
  const oneTime = ONE_TIME_PLANS.has(item.plan);
  const cardPath = () => onCard(item.plan, item.interval);

  return (
    <SheetFrame onClose={onClose} label={`Checkout — ${item.name}`}>
      <p className="mt-3 text-sm font-semibold uppercase tracking-wide text-taupe">One step left</p>
      <h2 className="mt-1 font-display text-2xl font-semibold text-ink">{item.name}</h2>
      <p className="mt-1 text-lg font-semibold text-forest">{item.priceLabel}</p>
      <p className="mt-1 text-sm leading-relaxed text-stone">{item.terms}</p>

      {state !== "card" && <div ref={walletRef} className="mt-5 min-h-12 w-full" />}
      {state === "loading" && (
        <p className="mt-3 text-center text-sm text-taupe">Preparing secure payment…</p>
      )}
      {state === "ready" && (
        <>
          <div className="mt-4 flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span className="text-xs text-taupe">or pay by card</span>
            <span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={cardPath} className="btn-ghost mt-4 min-h-12 w-full text-base">
            Pay by card
          </button>
        </>
      )}
      {state === "card" && (
        <button type="button" onClick={cardPath} className="btn-primary mt-6 min-h-12 w-full text-base">
          Pay by card
        </button>
      )}

      <button
        type="button"
        onClick={onClose}
        className="mt-4 min-h-11 w-full text-center text-base font-semibold text-stone underline-offset-4 hover:text-ink hover:underline"
      >
        Back
      </button>
      <p className="mt-3 text-center text-xs leading-relaxed text-taupe">
        Secure checkout by Stripe.
        {oneTime ? " One-time purchase — nothing renews." : " Cancel anytime — access continues through the paid period."}
      </p>
    </SheetFrame>
  );
}
