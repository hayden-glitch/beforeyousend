// Special-offer session logic (honest mechanics, per build brief rev 2 §4).
// A session-scoped counter tracks DISTINCT surface engagements; the offer
// qualifies at >= 2 surfaces in one session. Suppressed for users already on
// Ultimate, after the offer is accepted (localStorage), after any purchase this
// session, and never on cold landing / confirmation / onboarding pages.

const SURFACES_KEY = "bys_surfaces";
const SHOWN_KEY = "bys_offer_shown";
const ACCEPTED_KEY = "bys_offer_accepted";
const PURCHASED_KEY = "bys_purchased";
const VALUE_KEY = "bys_value_delivered";

export type OfferSurface =
  | "pricing"
  | "consultations"
  | "plan_chip"
  | "checkout_return"
  | "quota_cta";

/** Record a distinct surface engagement in this session. Returns surface count. */
export function recordSurface(name: OfferSurface): number {
  try {
    const s = window.sessionStorage;
    const list: string[] = JSON.parse(s.getItem(SURFACES_KEY) || "[]");
    if (!list.includes(name)) {
      list.push(name);
      s.setItem(SURFACES_KEY, JSON.stringify(list));
    }
    // Wake the SpecialOffer qualification timer (re-arm + live re-check) so a
    // route's surface record can never be missed due to React effect ordering
    // between the route component and the modal (mounted in __root). The
    // listener re-checks the full gate and fires the modal only when qualified.
    window.dispatchEvent(new CustomEvent("bys:surface"));
    return list.length;
  } catch {
    return 1;
  }
}

export function surfaceCount(): number {
  try {
    return JSON.parse(window.sessionStorage.getItem(SURFACES_KEY) || "[]").length;
  } catch {
    return 0;
  }
}

export function offerQualified(): boolean {
  return surfaceCount() >= 2;
}
export function offerAccepted(): boolean {
  try {
    return !!localStorage.getItem(ACCEPTED_KEY);
  } catch {
    return false;
  }
}
export function offerShownThisSession(): boolean {
  try {
    return !!sessionStorage.getItem(SHOWN_KEY);
  } catch {
    return false;
  }
}
export function markOfferShown(): void {
  try {
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    /* noop */
  }
}
export function markOfferAccepted(): void {
  try {
    localStorage.setItem(ACCEPTED_KEY, "1");
    sessionStorage.setItem(PURCHASED_KEY, "1");
  } catch {
    /* noop */
  }
}
export function markPurchasedThisSession(): void {
  try {
    sessionStorage.setItem(PURCHASED_KEY, "1");
  } catch {
    /* noop */
  }
}
export function purchasedThisSession(): boolean {
  try {
    return !!sessionStorage.getItem(PURCHASED_KEY);
  } catch {
    return false;
  }
}

// Value gate (owner 2026-08-10, reward-loop spec): no offer surface may appear
// in a session before at least one review completes (or the Check-In completes).
// ReviewTool/home dispatch markValueDelivered() when a review finishes; the
// Check-In marks it when its result screen is reached. Session-scoped so a
// returning visitor who already got value this session keeps the offer.
export function markValueDelivered(): void {
  try {
    sessionStorage.setItem(VALUE_KEY, "1");
  } catch {
    /* noop */
  }
}
export function valueDelivered(): boolean {
  try {
    return !!sessionStorage.getItem(VALUE_KEY);
  } catch {
    return false;
  }
}

/** Pages where the offer must never appear (cold landing, mid-signup, confirm,
 *  pricing — the auto-modal is killed on pricing; the launch offer there lives
 *  as the non-blocking in-flow card, per reward-loop spec Step 7 — and the
 *  hidden /quiz ad landing, whose payoff is the free account, not a plan sale;
 *  plus the hidden /verification page, which must stay completely plain). */
export function suppressForPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/confirm" || pathname === "/onboarding" || pathname === "/pricing" || pathname === "/quiz" || pathname === "/verification";
}
