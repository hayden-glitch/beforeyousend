// Co-Parent Check-In promo: group assignment read, suppression state, trigger
// logic, answer state, and the deterministic recommendation table (spec
// /home/team/shared/checkin-promo-design.md §3–§4). Pure client logic — no
// storage, no schema changes. Answers ride bys_events meta JSONB via track().

export type CheckinAnswer = string;
export type CheckinRec = {
  plan: "steady" | "command" | "ultimate" | "consultation";
  rec: string;
  price: string; // full price math line (ALWAYS full — honesty rule)
  cta: string;
  why: string;
  secondary: string; // quiet line under the CTA ("" when same as why)
};

// ---- Shared question bank (owner 2026-08-13) ----
// The 3 Co-Parent Check-In questions are ONE source of truth: the /login
// intake (the ad landing — intake-first signup) and the Check-In sheet on /
// and /home both read these arrays + labels. Never fork them.
export const Q1_CHIPS: [string, string][] = [
  ["custody_dispute", "We're in, or heading to, a custody dispute"],
  ["co_parent_conflict", "High conflict in almost every exchange"],
  ["schedule_logistics", "Mostly scheduling and logistics"],
  ["communication_only", "We co-parent OK, but messages go sideways"],
];
export const Q2_CHIPS: [string, string][] = [
  ["calm_replies", "Writing calm replies"],
  ["keeping_record", "Keeping a record of everything"],
  ["staying_organized", "Staying organized"],
  ["knowing_whats_fair", "Knowing what's fair"],
  ["all_of_it", "All of it, honestly"],
];
export const Q3_CHIPS: [string, string][] = [
  ["calmer_messages", "Calmer messages"],
  ["full_record", "A full record"],
  ["organized_evidence", "Organized evidence"],
  ["someone_to_talk", "Someone to talk it through"],
];
export const Q_LABELS: Record<string, string> = {};
for (const [v, l] of [...Q1_CHIPS, ...Q2_CHIPS, ...Q3_CHIPS]) Q_LABELS[v] = l;

// ---- Login intake persistence (owner 2026-08-13) ----
// The intake on /login asks the 3 questions before the email field. The
// answers ride into the account at confirm (profile.intake): they are stashed
// in sessionStorage (per-tab — the confirm hop is same-tab) and read by
// /confirm, which posts them in the /api/auth/confirm body (server-whitelisted).
// `bys_intake_done` (localStorage) is the returning-visitor flag: once set,
// /login skips the questions and shows the email form directly.
export type IntakeAnswers = { q1: string; q2: string; q3: string };
const INTAKE_DONE_KEY = "bys_intake_done";
const INTAKE_ANSWERS_KEY = "bys_intake_answers";
export function loginIntakeDone(): boolean {
  try {
    return !!localStorage.getItem(INTAKE_DONE_KEY);
  } catch {
    return false;
  }
}
export function markLoginIntakeDone(): void {
  try {
    localStorage.setItem(INTAKE_DONE_KEY, "1");
  } catch {
    /* noop */
  }
}
export function saveLoginIntake(a: IntakeAnswers): void {
  try {
    sessionStorage.setItem(INTAKE_ANSWERS_KEY, JSON.stringify(a));
  } catch {
    /* noop */
  }
}
export function loadLoginIntake(): IntakeAnswers | null {
  try {
    const raw = sessionStorage.getItem(INTAKE_ANSWERS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j && typeof j.q1 === "string" && typeof j.q2 === "string" && typeof j.q3 === "string")
      return { q1: j.q1, q2: j.q2, q3: j.q3 };
    return null;
  } catch {
    return null;
  }
}
export function clearLoginIntake(): void {
  try {
    sessionStorage.removeItem(INTAKE_ANSWERS_KEY);
  } catch {
    /* noop */
  }
}

const DONE_KEY = "bys_checkin_done";
const SHOWN_KEY = "bys_checkin_shown";
const DISMISSED_KEY = "bys_checkin_dismissed";

/** Cookie group ("on"|"off") assigned by the __root head script before first
 *  paint; the component reads it synchronously off <html data-checkin-group>. */
export function getCheckinGroup(): "on" | "off" {
  if (typeof document === "undefined") return "off";
  const v = document.documentElement.getAttribute("data-checkin-group");
  return v === "on" ? "on" : "off";
}

/** The pill may only appear on the landing page or the dashboard. */
export function checkinPathAllowed(pathname: string): boolean {
  return pathname === "/" || pathname === "/home";
}

export function checkinDone(): boolean {
  try {
    return !!localStorage.getItem(DONE_KEY);
  } catch {
    return false;
  }
}
export function markCheckinDone(): void {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* noop */
  }
}
export function checkinShownThisSession(): boolean {
  try {
    return !!sessionStorage.getItem(SHOWN_KEY);
  } catch {
    return false;
  }
}
export function markCheckinShown(): void {
  try {
    sessionStorage.setItem(SHOWN_KEY, "1");
  } catch {
    /* noop */
  }
}
export function checkinDismissedThisSession(): boolean {
  try {
    return !!sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return false;
  }
}
export function markCheckinDismissed(): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* noop */
  }
}

// Auth-state check: ONE /api/auth/me fetch per page load, cached at module
// scope (mirrors SpecialOffer's isUltimateUser pattern — no per-route auth
// traffic). isPaidUser() (CoParentCheckIn / SpecialOffer callers) and
// authMeOnce() (the /login gate) both derive from the same cached payload —
// /login never doubles the round-trip. A 401 or failed read resolves
// signed-out: the /login gate must show the intake, never break the funnel.
type MePayload = { user: { profile?: { tier?: string } } | null };
let mePayloadPromise: Promise<MePayload> | null = null;
function mePayload(): Promise<MePayload> {
  if (typeof window === "undefined") return Promise.resolve({ user: null });
  mePayloadPromise ||= fetch("/api/auth/me", { credentials: "include" })
    .then((r) => (r.ok ? r.json() : { user: null }))
    .catch(() => ({ user: null }));
  return mePayloadPromise;
}
export function isPaidUser(): Promise<boolean> {
  return mePayload().then((j) => {
    const t = j.user?.profile?.tier;
    return t === "steady" || t === "command" || t === "ultimate";
  });
}
export type AuthState = { signedIn: boolean; paid: boolean; tier?: string };
/** Resolved auth state for route gates (login.tsx): signedIn drives the
 *  signed-in redirect, paid the paid-tier suppression, tier is exposed for
 *  callers that need it. Cached with isPaidUser on the same payload. */
export function authMeOnce(): Promise<AuthState> {
  return mePayload().then((j) => {
    const tier = j.user?.profile?.tier;
    const signedIn = !!j.user;
    const paid = tier === "steady" || tier === "command" || tier === "ultimate";
    return { signedIn, paid, ...(tier ? { tier } : {}) };
  });
}

// ---- Recommendation table (§3: deterministic, first match wins; Q3 anchors,
// Q1/Q2 only upgrade) ----
const PRICES: Record<CheckinRec["plan"], { price: string; cta: string; why: string; secondary: string }> = {
  steady: {
    price: "$4.99 → $2.49/mo for your first 3 months (50% off), then $4.99. Cancel anytime.",
    cta: "Start Steady — $2.49/mo ×3",
    why: "Steady is built for that: unlimited history, Communication Log + Timeline, and your calmest replies.",
    secondary: "Building a case? Command Center organizes your evidence.",
  },
  command: {
    price: "$12.49 → $6.24/mo for your first 3 months (50% off), then $12.49. Cancel anytime.",
    cta: "Get Command Center — $6.24/mo ×3",
    why: "You said organized evidence. Command Center does that — Document Organizer, Case Summary, and Action Center, all live. Reviews, Log and Timeline included too.",
    secondary: "Want a human too? Ultimate adds a consultation each year.",
  },
  ultimate: {
    price: "$24.99 → $12.49/mo for your first 3 months (50% off), then $24.99. Cancel anytime.",
    cta: "Get Ultimate — $12.49/mo ×3",
    why: "The complete system — your record, your evidence, your next steps, and a human to talk it through (a consultation is included every year).",
    secondary: "Just need calmer replies? Steady is $2.49/mo ×3.",
  },
  consultation: {
    price: "$39.50 → $19.75 (50% off). One conversation, no subscription.",
    cta: "Book the conversation — $19.75",
    why: "One 45-minute conversation with a father who's navigated a custody case. No subscription.",
    secondary: "Want the record too? Steady keeps everything — $2.49/mo ×3.",
  },
};

const PLAN_NAMES: Record<CheckinRec["plan"], string> = {
  steady: "Steady",
  command: "Command Center",
  ultimate: "Ultimate Co-Parent",
  consultation: "One Conversation",
};

export function planName(plan: CheckinRec["plan"]): string {
  return PLAN_NAMES[plan];
}

/** Deterministic recommendation. Returns null on the skip path (no answers). */
export function recommend(
  q1?: string,
  q2?: string,
  q3?: string
): CheckinRec | null {
  const plan: CheckinRec["plan"] | null =
    q2 === "all_of_it"
      ? "ultimate"
      : q3 === "someone_to_talk" &&
        (q1 === "custody_dispute" || q2 === "staying_organized" || q2 === "keeping_record")
      ? "ultimate"
      : q2 === "staying_organized" && q1 === "custody_dispute"
      ? "command"
      : q2 === "knowing_whats_fair" && q1 === "custody_dispute"
      ? "command"
      : q3 === "calmer_messages" || q3 === "full_record"
      ? "steady"
      : q3 === "organized_evidence"
      ? "command"
      : q3 === "someone_to_talk"
      ? "consultation"
      : null;
  if (!plan) return null;
  const rec =
    q2 === "all_of_it"
      ? "u2_all"
      : q3 === "someone_to_talk" &&
        (q1 === "custody_dispute" || q2 === "staying_organized" || q2 === "keeping_record")
      ? "u1_human_plus"
      : q2 === "staying_organized" && q1 === "custody_dispute"
      ? "u3_org_dispute"
      : q2 === "knowing_whats_fair" && q1 === "custody_dispute"
      ? "u4_fair_dispute"
      : q3
      ? `anchor_${q3}`
      : "";
  return { plan, rec, ...PRICES[plan] };
}
