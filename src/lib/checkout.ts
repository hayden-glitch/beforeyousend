// ─────────────────────────────────────────────────────────────────────────────
// SINGLE CHECKOUT COORDINATOR (checkout-reliability rebuild, slice 1)
// One shared, testable purchase-intent/checkout controller that EVERY
// entitlement-bearing purchase entry point routes through (pricing plans,
// sticky CTA, one-time packs, consultations, gift, sort pile, quota walls,
// check-in, special offer).
//
// State machine per deliberate tap:
//   idle → intent captured → auth resolving → (auth required | checkout
//   opening) → payment UI → success / cancel / error
//
// Rules enforced here (work order 5313520463):
//   1. Immediate visual acknowledgement is the CALLER's job (it sets busy
//      synchronously in onClick before awaiting us). We keep busy until an
//      exit path resolves it.
//   2. Module-level in-flight ref lock: a second tap cannot start a second
//      request while an attempt is active. 10 rapid taps = 1 attempt.
//   3. Auth state is resolved via a FRESH /api/auth/me before any
//      entitlement-bearing Stripe call (the module-scope cache in checkin.ts
//      may be stale — checkout must never trust it).
//   4. Signed out → DO NOT call Stripe. Persist the finite intent to
//      sessionStorage (bys:checkout_intent_v1) and immediately navigate to
//      the existing /login?next= continuation flow.
//   5. Signed-in UI but server 401 → auth_expired: persist intent and route
//      to login immediately (no off-screen recovery link).
//   6. Any other checkout-creation failure → error adjacent to the checkout
//      surface (caller's onError), busy reset.
//   7. EVERY exit path clears/restores busy (finally).
//
// The server 401 is CORRECT and stays (Track B pre-pay account invariant) —
// this file fixes the client journey, never the server response.
// ─────────────────────────────────────────────────────────────────────────────
import { track } from "~/lib/analytics";

export type CheckoutPlan =
  | "steady"
  | "command"
  | "ultimate"
  | "topup"
  | "sortpile"
  | "attorney_prep_pack"
  | "record_review"
  | "consultation"
  | "gift";
export type CheckoutInterval = "month" | "year";
export type CheckoutSource =
  | "pricing"
  | "sticky"
  | "consultations"
  | "home"
  | "review_tool"
  | "sortpile"
  | "special_offer"
  | "checkin"
  | "quota_wall";

/** Finite, non-sensitive purchase intent. Fields ONLY: plan/interval/source/
 *  offer/checkin/intentId — never free text, never check-in answers, never
 *  document/draft data, never customer data, never Stripe identifiers. */
export interface CheckoutIntent {
  plan: CheckoutPlan;
  interval: CheckoutInterval;
  source: CheckoutSource;
  offer: boolean;
  checkin: boolean;
  intentId: string;
}

export type CheckoutOutcome =
  | { state: "opening"; url: string; plan: CheckoutPlan }
  | { state: "auth_required"; loginHref: string }
  | { state: "error"; message: string }
  | { state: "skipped" };

export interface CheckoutOptions {
  plan: CheckoutPlan;
  interval?: CheckoutInterval;
  source: CheckoutSource;
  offer?: boolean;
  checkin?: boolean;
  /** Where to return after the login round-trip. Default: current path+query. */
  continuation?: string;
  /** Synchronous busy toggler on the tapped CTA (caller sets busy BEFORE
   *  calling runCheckout for the immediate visual ack; we clear it on every
   *  terminal exit). */
  setBusy?: (busy: boolean) => void;
  /** Surface-adjacent error display (rule 6). */
  onError?: (message: string) => void;
}

// ---- strict allowlists ------------------------------------------------------
const PLANS: readonly CheckoutPlan[] = [
  "steady", "command", "ultimate", "topup", "sortpile",
  "attorney_prep_pack", "record_review", "consultation", "gift",
];
const INTERVALS: readonly CheckoutInterval[] = ["month", "year"];
const SOURCES: readonly CheckoutSource[] = [
  "pricing", "sticky", "consultations", "home", "review_tool",
  "sortpile", "special_offer", "checkin", "quota_wall",
];
const isOneOf = <T extends string>(v: unknown, list: readonly T[]): v is T =>
  typeof v === "string" && (list as readonly string[]).includes(v);

// ---- intent persistence (sessionStorage) ------------------------------------
const INTENT_KEY = "bys:checkout_intent_v1";

export function sanitizeIntent(raw: unknown): CheckoutIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isOneOf(o.plan, PLANS)) return null;
  if (!isOneOf(o.interval, INTERVALS)) return null;
  if (!isOneOf(o.source, SOURCES)) return null;
  if (typeof o.intentId !== "string" || !o.intentId) return null;
  return {
    plan: o.plan,
    interval: o.interval,
    source: o.source,
    offer: o.offer === true,
    checkin: o.checkin === true,
    intentId: o.intentId,
  };
}

function writeIntent(intent: CheckoutIntent): void {
  try {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* storage unavailable (private mode) — the ?next= continuation still
       returns the user to the surface; they re-tap once (no data loss) */
  }
}

export function peekIntent(): CheckoutIntent | null {
  try {
    const raw = sessionStorage.getItem(INTENT_KEY);
    return raw ? sanitizeIntent(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Consume the intent EXACTLY ONCE (read + clear atomically). Callers must
 *  only take it immediately before attempting the resumed checkout, so a
 *  back/reload/cancel after the attempt cannot re-create a Stripe session. */
export function takeIntent(): CheckoutIntent | null {
  const intent = peekIntent();
  if (intent) clearIntent();
  return intent;
}

export function clearIntent(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY);
  } catch {
    /* noop */
  }
}

function makeIntentId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ---- auth resolution (fresh, never cached) ----------------------------------
function freshMe(): Promise<{ signedIn: boolean }> {
  return fetch("/api/auth/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .then((j) => ({ signedIn: !!j.user }))
    .catch(() => {
      // Network failure: we cannot resolve auth. Fall through to the guarded
      // Stripe call — the server is the authority and 401s if unauthenticated
      // (rule 5 handles the race); a local /me outage must not hard-block.
      return { signedIn: true };
    });
}

function sanitizeContinuation(c?: string): string {
  const fallback =
    typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : "/pricing";
  if (!c) return fallback;
  if (!c.startsWith("/") || c.startsWith("//") || c.includes("://") || c.includes("\\")) return fallback;
  return c;
}

// ---- in-flight lock (rule 2) -------------------------------------------------
let inFlight = false;

/** The one entitlement-bearing checkout entry. Every caller funnels through
 *  here — no component keeps its own subtly different 401/busy/continuation
 *  behavior anymore. */
export async function runCheckout(opts: CheckoutOptions): Promise<CheckoutOutcome> {
  if (inFlight) return { state: "skipped" };
  inFlight = true;
  opts.setBusy?.(true);
  const plan = opts.plan;
  const interval = opts.interval ?? "month";
  const source = opts.source;
  const offer = opts.offer === true;
  const checkin = opts.checkin === true;
  const intent: CheckoutIntent = { plan, interval, source, offer, checkin, intentId: makeIntentId() };
  // Funnel: ONE checkout_started per real attempt (10 taps = 1 attempt, so no
  // event spam; shape matches the previous callers: plan/interval + source
  // only for check-in, offer marker only when the intro applies).
  track("checkout_started", {
    plan,
    interval,
    ...(source === "checkin" ? { source: "checkin" } : {}),
    ...(offer ? { offer: true } : {}),
  });
  try {
    // Rule 3: resolve auth BEFORE any Stripe call.
    const auth = await freshMe();
    if (!auth.signedIn) {
      // Rule 4: persist the finite intent, then go to login immediately.
      writeIntent(intent);
      const next = sanitizeContinuation(opts.continuation);
      const href = `/login?next=${encodeURIComponent(next)}`;
      window.location.href = href;
      return { state: "auth_required", loginHref: href };
    }
    // Signed in — open checkout. Gift rides /api/gifts (auth-gated server
    // side, same invariant); everything else goes through /api/checkout.
    const r = await fetch(plan === "gift" ? "/api/gifts" : "/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, interval, intentId: intent.intentId, ...(offer ? { offer: true } : {}), ...(checkin ? { checkin: true } : {}) }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.url) {
      // Payment UI is Stripe's hosted session — the caller navigates so it
      // can run surface-specific side effects (markCheckinDone etc.) first.
      return { state: "opening", url: d.url, plan };
    }
    if (r.status === 401 || d.login_required) {
      // Rule 5: UI believed signed-in but the server says otherwise —
      // session expired/revoked mid-flow. Persist and route to login NOW.
      writeIntent(intent);
      const next = sanitizeContinuation(opts.continuation);
      const href = `/login?next=${encodeURIComponent(next)}`;
      window.location.href = href;
      return { state: "auth_required", loginHref: href };
    }
    // Rule 6: any other failure — show the error on the surface, reset busy.
    const message = typeof d.error === "string" && d.error
      ? d.error
      : "Checkout is not available right now.";
    opts.onError?.(message);
    return { state: "error", message };
  } catch {
    const message = "Checkout is not available right now.";
    opts.onError?.(message);
    return { state: "error", message };
  } finally {
    // Rule 7: EVERY exit path restores busy (navigation to Stripe/login makes
    // this moot — the page is leaving — but it keeps state honest for any
    // path that stays).
    inFlight = false;
    opts.setBusy?.(false);
  }
}

// ---- confirm-return guard ----------------------------------------------------
// pricing.tsx / consultations.tsx capture a Stripe success return at first
// render (pre-scrub). While a confirm round-trip is pending, the resumer must
// NOT auto-resume a parked intent (that would open a SECOND checkout while
// the first purchase is being linked).
let confirmPending = false;
export function markConfirmPending(): void {
  confirmPending = true;
}
function consumeConfirmPending(): boolean {
  const was = confirmPending;
  confirmPending = false;
  return was;
}

// ---- resume after login (route-change aware) ---------------------------------
// Fired from __root so it covers EVERY surface (SPA + hard navigations):
// a signed-out tap persists the intent → /login?next=... → after sign-in the
// visitor lands back on the surface → this resumer consumes the intent once
// and re-runs the exact checkout they asked for, no re-picking.
import { useEffect, useRef } from "react";
import { useLocation } from "@tanstack/react-router";

const CHECKOUT_ERROR_EVENT = "bys:checkout-error";
export function dispatchCheckoutError(message: string): void {
  try {
    window.dispatchEvent(new CustomEvent(CHECKOUT_ERROR_EVENT, { detail: message }));
  } catch {
    /* noop */
  }
}

export function useCheckoutIntentResumer(): void {
  // Re-renders on every route change (same hook the modal components use), so
  // a parked intent is re-checked after both SPA and hard navigations.
  const href = useLocation().href;
  const consumedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // A Stripe success/cancel return owns this load — the confirm/return
    // effects on the surface handle it; never stack a new checkout on top.
    if (consumeConfirmPending()) return;
    const intent = peekIntent();
    if (!intent) return;
    if (consumedRef.current.has(intent.intentId)) return;
    let alive = true;
    freshMe().then((a) => {
      if (!alive) return;
      if (!a.signedIn) {
        // Still signed out (user backed out of /login): leave the intent
        // parked — no navigation loop, no loss; the next sign-in resumes it.
        return;
      }
      consumedRef.current.add(intent.intentId);
      takeIntent(); // consume exactly once, atomically, BEFORE attempting
      void runCheckout({
        plan: intent.plan,
        interval: intent.interval,
        source: intent.source,
        offer: intent.offer,
        checkin: intent.checkin,
        continuation: window.location.pathname + window.location.search,
        onError: dispatchCheckoutError,
      });
    });
    return () => {
      alive = false;
    };
  }, [href]);
}
