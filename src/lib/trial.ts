// Client-side support for the 24-hour free trial (owner 2026-08-13).
// Three cooperating pieces:
//  1. Dismissal cookie (30d) — "No thanks" means no re-prompt for a month.
//  2. Trial-intent marker (localStorage) — an anonymous visitor who taps
//     "Yes, try it free" carries intent through the email capture; the moment
//     their account is confirmed (session live), maybeStartTrial() fires the
//     grant so they land in the app with the trial already active.
//  3. Device-aware pay row detection — iPhone/iOS shows Apple Pay prominent,
//     Android shows Google Pay prominent, desktop gets a plain small card row.
// Honesty rails: the trial is real (24h of the full paid experience, no card,
// one per person ever); no urgency words anywhere; dismissal is respected.

const DISMISSED_COOKIE = "bys_trial_dismissed";
const INTENT_KEY = "bys_trial_intent";
// Explicit-open buffer (GPT cleanup P1 2026-08-16): /pricing's inline trial
// CTA sets a session flag BEFORE dispatching bys:open-trial. The modal is a
// lazily-deferred chunk (DeferredMount arms on first interaction / 6s cap) —
// a fast mobile tap can dispatch before the listener exists and the event
// would be lost. TrialModal clears the flag when it handles the event; if the
// event was missed, the flag is honored the moment the chunk mounts.
const OPEN_PENDING_KEY = "bys_trial_open_pending";
export function trialOpenPending(): boolean {
  try {
    return sessionStorage.getItem(OPEN_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}
export function setTrialOpenPending(): void {
  try {
    sessionStorage.setItem(OPEN_PENDING_KEY, "1");
  } catch {
    /* noop */
  }
}
export function clearTrialOpenPending(): void {
  try {
    sessionStorage.removeItem(OPEN_PENDING_KEY);
  } catch {
    /* noop */
  }
}

// Login intake suppression (owner 2026-08-13): while the 3-question intake is
// showing on /login the TrialModal must NOT fire — the intake IS the
// engagement (and the trial starts quietly at account confirm via
// maybeStartTrial for anyone who carried intent). Session-scoped flag set by
// login.tsx the moment the intake appears; never two asks on that page. A
// returning visitor (intake skipped, no flag) keeps the old /login behavior.
const LOGIN_INTAKE_KEY = "bys_login_intake_active";
export function loginIntakeActive(): boolean {
  try {
    return sessionStorage.getItem(LOGIN_INTAKE_KEY) === "1";
  } catch {
    return false;
  }
}
export function markLoginIntakeActive(): void {
  try {
    sessionStorage.setItem(LOGIN_INTAKE_KEY, "1");
  } catch {
    /* noop */
  }
}

export function trialDismissed(): boolean {
  try {
    return document.cookie.split("; ").some((c) => c.startsWith(DISMISSED_COOKIE + "="));
  } catch {
    return false;
  }
}
export function markTrialDismissed(): void {
  try {
    document.cookie = `${DISMISSED_COOKIE}=1; Max-Age=2592000; Path=/; SameSite=Lax`;
  } catch {
    /* noop */
  }
}

export function hasTrialIntent(): boolean {
  try {
    return localStorage.getItem(INTENT_KEY) === "1";
  } catch {
    return false;
  }
}
export function setTrialIntent(): void {
  try {
    localStorage.setItem(INTENT_KEY, "1");
  } catch {
    /* noop */
  }
}
export function clearTrialIntent(): void {
  try {
    localStorage.removeItem(INTENT_KEY);
  } catch {
    /* noop */
  }
}

// One modal at a time: TrialModal and SpecialOffer share a window-level lock so
// they can never stack. The lock is set the moment a modal opens and cleared on
// close; the OTHER modal checks it at fire time and defers (trial wins on
// /pricing because its 2s timer fires before the offer's 4.5s; elsewhere the
// first-qualified modal wins and the other waits).
declare global {
  interface Window {
    __bysModalOpen?: boolean;
  }
}
export function modalOpen(): boolean {
  return typeof window !== "undefined" && window.__bysModalOpen === true;
}
export function claimModal(): void {
  if (typeof window !== "undefined") window.__bysModalOpen = true;
}
export function releaseModal(): void {
  if (typeof window !== "undefined") window.__bysModalOpen = false;
}

// Fire the grant if this browser carries trial intent (anonymous Yes → capture
// → confirm → auto-start). Idempotent: the marker is removed on success or on
// an honest 409 (already used / already active). A 401 means the session isn't
// live yet — leave the marker for the dashboard fallback. Never throws.
export async function maybeStartTrial(): Promise<boolean> {
  if (typeof window === "undefined" || !hasTrialIntent()) return false;
  try {
    const r = await fetch("/api/trial/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ source: "trial_modal" }),
    });
    if (r.ok) {
      clearTrialIntent();
      try {
        window.dispatchEvent(new CustomEvent("bys:trial-started", { detail: { ok: true } }));
      } catch {
        /* noop */
      }
      return true;
    }
    if (r.status === 409) {
      clearTrialIntent();
      return false;
    }
    return false; // 401 / network — keep the marker for the next mount
  } catch {
    return false;
  }
}

export type PayBrand = "apple" | "google" | "plain";

// Tap-to-pay mark for the visitor's OWN phone: iOS (iPhone/iPad/iPod) → Apple
// Pay; Android → Google Pay; anything else (desktop) → plain card row. Uses
// userAgentData when present (UA-free), falls back to the UA string otherwise.
export function payBrand(): PayBrand {
  if (typeof navigator === "undefined") return "plain";
  try {
    const uad = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
    const platform = (uad?.platform || "").toLowerCase();
    if (platform === "android") return "google";
    if (platform === "iphone" || platform === "ipad" || platform === "ipod") return "apple";
    if (platform === "macos" && typeof document !== "undefined" && "ontouchend" in document) return "apple"; // iPadOS masquerades as macOS
  } catch {
    /* fall through to UA */
  }
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return "apple";
  if (/Android/.test(ua)) return "google";
  return "plain";
}
