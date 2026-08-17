// Root-level bridge for RESUMED checkouts (P1 fix 2026-08-17).
//
// The direct checkout path (a tap on a plan/one-time CTA) handles its own
// opening outcome with page-local state and renders PaymentSurface in place.
// The RESUMED path (signed-out tap → /login?next= → sign-in → the resumer in
// __root re-runs the parked intent) has no page-local payOutcome to attach to,
// so checkout.ts re-broadcasts a custom-mode opening as a bys:checkout-opening
// window event and this bridge renders the same branded PaymentSurface at the
// root level — on ANY surface. Hosted-mode openings never reach here (the
// resumer navigates to the hosted Stripe page directly); this is only the
// in-app branded surface, and only when this build can actually render it
// (custom session + baked publishable key — paymentSurfaceAvailable).
import { lazy, Suspense, useEffect, useState } from "react";
import { dispatchCheckoutError, type CheckoutOpening } from "~/lib/checkout";

const CHECKOUT_OPENING_EVENT = "bys:checkout-opening";

function CheckoutOpeningBridgeInner() {
  const [opening, setOpening] = useState<CheckoutOpening | null>(null);
  useEffect(() => {
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<CheckoutOpening>).detail;
      if (d && d.state === "opening") setOpening(d);
    };
    window.addEventListener(CHECKOUT_OPENING_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(CHECKOUT_OPENING_EVENT, onOpen as EventListener);
  }, []);
  if (!opening) return null;
  return (
    <Suspense fallback={null}>
      <PaymentSurface
        outcome={opening}
        onClose={() => setOpening(null)}
        // Same error slot as every other surface: the page-level listeners on
        // bys:checkout-error show it surface-adjacent (pricing/consultations/
        // home/… all subscribe).
        onError={dispatchCheckoutError}
      />
    </Suspense>
  );
}

// Lazy: PaymentSurface pulls @stripe/stripe-js — keep it out of the initial
// bundle (it only ever renders after a resumed checkout actually opens, and
// only on the rare custom-mode path; hosted-mode never mounts it).
const PaymentSurface = lazy(() => import("~/components/PaymentSurface"));

export default function CheckoutOpeningBridge() {
  return (
    <Suspense fallback={null}>
      <CheckoutOpeningBridgeInner />
    </Suspense>
  );
}
