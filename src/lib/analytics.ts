// Tiny client-side analytics plumbing. Pixels plug in later: when the server
// env provides TIKTOK_PIXEL_ID / GOOGLE_ADS_ID, the base scripts are injected
// and events are forwarded. With nothing configured this module no-ops cleanly
// and ships ~0 bytes of tracking. (Meta/Facebook fbq was removed per owner
// decision 2026-08-09 — no Meta ads.)
//
// Metrics 2.0 (owner 2026-08-10): every persisted event carries client-derived
// dt (ms since the previous row in the visitor session) and t (ms since session
// start) from the monotonic session clock, and each page view records a
// page_enter for the owner's second-by-second session playback. Scroll sampling
// lives in sessionPlay.ts (initialized here). All of it is failure-proof.

import { onPageEnter, initScrollSampling, sessionT, sessionDt } from "./sessionPlay";

export type AnalyticsConfig = {
  tiktokPixelId?: string;
  googleAdsId?: string;
  // SSR decision (Codex final-fold Blocker 1, comment 5300270649): true when
  // the incoming page request carried a sensitive app query key — SSR omits
  // the Google loader/bootstrap for that document and the client defers the
  // TikTok load until the route scrubs the URL.
  sensitive?: boolean;
};

export type AnalyticsEvent =
  | "landing_page_visit"
  | "landing_module_click"
  | "hero_view"
  | "hero_cta_click"
  | "review_started"
  | "review_completed"
  | "review_typing_started"
  | "review_typing_active"
  | "review_failed"
  | "email_submitted"
  | "email_resend"               // /confirm resend — a fresh confirm link was issued (NOT a first capture; Fix 6 audit 85fbc48d)
  | "capture_card_view"
  | "email_confirmed"
  | "account_created"
  | "signup_details_removed"  // confirm error state — dad removed his captured details
  | "login_success"
  | "pricing_viewed"
  | "consultation_viewed"
  | "checkout_started"
  // Round-6 funnel events (2026-08-13) — the guided-funnel vocabulary for the
  // owner funnel boards. NEVER carry draft text, email addresses, names, or
  // answer content — meta holds step/plan/interval/method-category only.
  | "funnel_started"           // meta: { entry }      — first funnel engagement in a tab (once)
  | "funnel_step_viewed"       // meta: { step }       — a guided-flow step rendered (intake_q1..signup_form)
  | "funnel_option_selected"   // meta: { step|plan }  — a non-sensitive option picked (no answer text)
  | "signup_started"           // meta: { source }     — account-creation attempt began (once per tab)
  | "signup_completed"         // meta: { source }     — account created (server-confirmed; once)
  | "checkout_wallet_available" // meta: { methods }   — browser supports wallet payment (method category only)
  | "purchase_completed"       // SERVER event — meta: { kind, interval? } — any verified paid grant
  | "subscription_purchased"
  | "consultation_purchased"
  | "timeline_entry_added"
  | "special_offer_shown"
  | "trial_modal_shown"             // 24h-trial modal appeared (meta: { path })
  | "trial_modal_yes"               // Yes tapped (anonymous -> capture w/ intent)
  | "trial_modal_no"                // No thanks tapped (30-day dismissal cookie)
  | "trial_started"                 // grant confirmed client-side (server: trial_start)
  | "special_offer_dismissed"
  | "special_offer_accepted"
  | "topup_purchased"
  | "sortpile_view"           // meta: { plan }          — Sort My Pile view mounted
  | "sortpile_added"          // meta: { n }               — papers added to the pile
  | "sortpile_started"        // meta: { n }               — sort job started
  | "sortpile_purchase"       // meta: { plan }            — Sort My Pile confirmed
  | "attorney_prep_pack_purchase" // meta: { plan }        — Attorney Prep Pack confirmed
  | "record_review_purchase"  // meta: { plan }            — Record Review confirmed
  | "record_review_started"   // meta: { plan }            — Record Review generate tapped (client)
  | "record_review_generated" // SERVER event — meta: { plan, fallback } — report generated + persisted
  | "record_review_failed"    // meta: { plan }            — generate/persist errored
  | "record_review_downloaded" // meta: { plan }           — report file downloaded
  | "sortpile_extract_start"   // meta: { n }                — client-side text extraction began (on-device)
  | "sortpile_extract_done"    // meta: { n, chars }         — client-side text extraction finished
  | "sortpile_extract_blocked" // meta: { reason }           — a paper couldn't be read (oversize/corrupt/unknown)
  | "sortpile_content_filed"   // meta: { folder }           — a text-read paper filed from its own content
  | "plan_chip_click"
  | "quota_cta_click"
  | "quota_wall_shown"           // meta: { plan }          — signed-in 402 quota wall rendered (two-option offer)
  | "quota_wall_topup_click"     // meta: { plan }          — Top-Up card CTA tapped on the quota wall
  | "quota_wall_ultimate_click"  // meta: { plan }          — Ultimate card CTA tapped on the quota wall
  | "feedback_helped_calm"
  | "feedback_good_read"
  | "feedback_not_for_me"
  | "checkin_shown"
  | "checkin_started"
  | "checkin_q1_answered"
  | "checkin_q2_answered"
  | "checkin_q3_answered"
  | "checkin_recommended"
  | "checkin_cta_clicked"
  | "checkin_dismissed"
  | "checkin_skipped"
  // Login intake (owner 2026-08-13): the 3 Co-Parent Check-In questions open
  // /login (the ad landing) — email capture moves after the questions.
  | "login_intake_started"       // meta: { ttclid?, gad?, gclid? } — questions shown to a fresh visitor
  | "login_intake_q1_answered"   // meta: { answer }               — Q1 chip tapped
  | "login_intake_q2_answered"   // meta: { answer }               — Q2 chip tapped
  | "login_intake_q3_answered"   // meta: { answer }               — Q3 chip tapped
  | "login_intake_completed"     // meta: { q1, q2, q3 }           — all 3 answered, email form shown
  | "password_set"
  | "organizer_promo_shown"
  | "organizer_promo_clicked"
  | "organizer_trial_started"          // meta: { kind, promo }      — trial item submitted
  | "organizer_trial_completed"        // SERVER event — meta: { kind, folder, promo, remaining, count } (count = which item, 1..5)
  | "organizer_upgrade_clicked"
  | "organizer_open"
  | "organizer_upload"
  | "organizer_classify"
  | "organizer_folder_view"
  | "organizer_delete"
  | "case_summary_view"
  | "case_summary_generate"
  | "action_center_view"
  | "action_center_generate"
  | "did_send_prompt_shown"
  | "did_send_yes"
  | "did_send_no"
  | "did_send_tone"
  | "send_confidence_shown"   // meta: { plan, tone, score }  — DidYouSendIt sent-state rendered (once per completion)
  | "manual_tone_picked"      // meta: { tone }               — Add-form entry saved with a manual tone
  | "digest_view"             // meta: { plan }               — DigestCard mounted
  | "digest_share"            // meta: { plan }               — share summary copied
  | "gift_code_created"       // meta: { plan }               — gift code shown after payment
  | "gift_share"              // meta: { plan }               — gift code/link copied
  | "gift_redeem_view"        // meta: {}                     — redeem page, valid code, signed in
  | "gift_redeemed"           // meta: { plan }               — redeem succeeded
  | "digest_locked_shown"      // meta: { plan }               — free-tier digest teaser rendered (optional)
  | "organizer_drawer_open"    // meta: { plan, kind }         — Organizer drawer opened
  | "organizer_rename"         // meta: { plan }               — rename saved
  | "organizer_move"           // meta: { plan }               — move saved (new; moves were untracked)
  | "timeline_ribbon_view"     // meta: { plan }               — ribbon first rendered (once per mount)
  | "timeline_ribbon_filter"   // meta: { kind }               — kind tile tapped
  | "timeline_item_view"       // meta: { kind }               — message/document detail opened
  | "lamp_shown"               // meta: { score, label }       — 11pm lamp first rendered (once per completion)
  | "lamp_save"                // meta: { score }              — Save it for tomorrow tapped
  | "lamp_dismiss"             // meta: {}                     — lamp [×]
  | "tomorrow_draft_loaded"    // meta: {}                     — draft loaded into a paste box
  | "tomorrow_draft_removed"   // meta: {}                     — draft removed
  | "export_started"           // meta: { plan }               — export requested (tap)
  | "export_downloaded"        // meta: { plan }               — record file downloaded
  | "export_failed"            // meta: { plan }               — export errored
  | "attorney_pack_started"    // meta: { plan }               — pack generation requested (tap)
  | "attorney_pack_downloaded" // meta: { plan }               — pack file downloaded
  | "attorney_pack_failed"     // meta: { plan }               — pack generation errored
  | "organizer_needs_sorting"          // meta: { plan, kind }    — upload classified other/needs-sorting (notice card shown)
  | "organizer_needs_sorting_view"     // meta: { plan }          — needs-sorting strip/rows seen (once per mount)
  | "organizer_needs_sorting_dismissed" // meta: { plan }         — notice card or strip dismissed
  | "organizer_refile_failed"          // meta: { plan }          — refile PATCH errored
  | "organizer_refile_pick_folder"     // meta: { plan }          — still-unsure → "Pick the folder" (manual move picker)
  | "child_capture_started"            // meta: { plan }          — capture sheet opened (folder or ✎)
  | "child_saved"                      // meta: { plan, gender }  — child name saved (girl|boy|neutral)
  | "child_removed"                     // meta: { plan }          — child folder removed (two-tap confirm)
  | "review_rename"                     // meta: { plan }          — saved review/analysis renamed
  | "organizer_folder_open"            // meta: { plan }          — closed folder tapped open (tap-to-open)
  | "organizer_folder_parked"          // meta: { plan }          — folder parked (--open crossed 0.85)
  // Two-mode AI Co-Parent (owner 2026-08-11): Situation Analyzer mode.
  | "mode_switched"                    // meta: { mode }          — review|analyze pill tapped
  | "analyze_started"                  // meta: { auth }          — analyzer stream launched
  | "analyze_completed"                // meta: { auth, example? } — analyzer stream finished
  | "analysis_saved"                  // meta: { plan }          — analysis saved to the record (kind:"analysis")
  // Attachments (Steady+, owner 2026-08-11) — two-mode AI Co-Parent §3/§4.
  | "attach_locked_tap"               // meta: { mode }          — ghost chip tapped (free/signed-out enticement)
  | "steady_sheet_shown"              // meta: { mode }          — Steady enticement sheet rendered
  | "attach_added"                    // meta: { mode, count }   — file(s) picked in the attach sheet
  | "attach_removed"                  // meta: { mode }          — attachment chip removed (sheet or composer)
  // User menu + /account (owner-batch DESIGN 2, 2026-08-12).
  | "user_menu_open"                  // meta: { context }       — menu opened (header|dashboard)
  | "user_menu_nav"                   // meta: { item }          — menu entry tapped (plan|profile_account|export|consultations|help_faq|privacy|logout)
  | "account_view"                    // meta: {}                — /account mounted with a session
  | "account_profile_saved"           // meta: {}                — profile name save landed
  // Owner batch 2 (Design 1, 2026-08-12): the child's folder open state — Exchange Tone ratings + to-do.
  | "folder_rating_set"               // meta: { plan, week, value } — weekly Exchange Tone rating set (calm|mixed|stormy)
  | "folder_tone_chip_tap"            // meta: { plan, tone }        — tone tally chip expanded/collapsed
  | "folder_todo_add"                 // meta: { plan }              — to-do item added to {Name}'s list
  | "folder_todo_toggle"              // meta: { plan }              — to-do item toggled done/undone
  | "folder_todo_delete"              // meta: { plan }              — to-do item removed
  | "folder_todo_clear_done"          // meta: { plan }              — "Clear done" tapped
  | "folder_action_suggestion_tap"    // meta: { plan }              — Action Center suggestion deep-linked
  | "log_child_tagged"                // meta: { plan, child }       — log entry tagged to a child's folder
  // Landing "Sort one thing free" demo (2026-08-12) — fully client-side, rule-based.
  | "landing_sort_view"               // meta: {}                    — demo card mounted (once per page load)
  | "landing_sort_started"            // meta: { kind }              — text|file — demo run began
  | "landing_sort_done"               // meta: { kind, folder }      — folder result shown (folder = slug)
  | "landing_sort_cta"               // meta: { target }            — sortpile|account — demo CTA tapped
  // 5-Paper Trial (2026-08-12, preflight 766ccd02) — organizer trial 1→5.
  | "organizer_trial_chip"           // meta: { label }             — starter chip tapped (last text / daycare-school bill / school email)
  | "organizer_trial_upsell_shown"   // meta: { remaining: 0 }      — upsell first rendered (once per mount, money moment)
  | "organizer_first_file"           // meta: {}                    — first of 5 trials filed (trial.count === 1)
  | "organizer_trial_count_view"     // meta: { remaining }         — "{n} of 5 free" progress line seen (per value)
  // Record Health (organizer-expansion spec §1, Slice 1) — deterministic
  // coverage ring + finding cards. Client-fired; the server never double-logs.
  | "record_health_view"              // meta: { plan, band, coverage, gaps, missing } — panel/strip first rendered (once per mount)
  | "record_health_gap_log"           // meta: { gap }              — "Log it now" tapped on the amber gap card (gap = "Aug 3–Aug 10")
  | "record_health_missing_add"       // meta: { folder }           — "Add the paper" tapped on a missing-doc card
  | "record_health_teaser_click"      // meta: {}                   — teaser CTA tapped (non-Command dad, → Command Center)
  // Hidden /quiz ad landing (2026-08) — "Are you a good co-parent?" quiz.
  // All quiz events carry meta.source = "quiz" so the funnel segments cleanly;
  // the grade event also carries the deterministic band + score.
  | "quiz_viewed"                     // meta: { source }           — quiz page mounted (once per load)
  | "quiz_started"                    // meta: { source }           — "Let's go" tapped
  | "quiz_answered"                   // meta: { source, q }        — a choice picked (q = 1..5)
  | "quiz_completed"                  // meta: { source, score, band } — all 5 answered (grade pending)
  | "quiz_grade_shown"                // meta: { source, band, score } — grade screen rendered (once)
  // Hidden /verification page (2026-08) — owner-identity page for Google's
  // developer/verification reviewer. One event, source-parammed like /quiz.
  | "verification_viewed"             // meta: { source }           — verification page mounted (once per load)

declare global {
  interface Window {
    ttq?: any;
    dataLayer?: Record<string, unknown>[];
    gtag?: (...args: unknown[]) => void;
  }
}

let initialized = false;
export const GOOGLE_ADS_ID = "AW-18234635191";
export const GOOGLE_SIGNUP_DESTINATION = `${GOOGLE_ADS_ID}/XeTXCOT1muEcELfn-fZD`;
// Canonical Google tag bootstrap supplied by Google Ads for this account. It
// lives directly in the shared document head (clean pages only — see
// __root.tsx) so every route has a ready gtag queue before React mounts.
// send_page_view:false keeps trackPageView() as the single page-view fire
// point. injectGoogleTagIfNeeded() reuses it to re-initialize measurement on
// the clean URL after a sensitive-query page scrubs its credential.
export const GOOGLE_TAG_BOOTSTRAP = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=window.gtag||gtag;gtag('consent','default',{ad_storage:'granted',analytics_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'});gtag('js',new Date());gtag('config','${GOOGLE_ADS_ID}',{send_page_view:false});`;
// Dedup window (audit 85fbc48d Fix 3): page_view/page_enter collapse query-string
// variations of the SAME pathname within 30s per tab — "/?a=1" and "/?a=2" on one
// route load count once, and the ttclid redirect hop collapses with the final
// landing page. A real revisit to a DIFFERENT path still counts.
const PAGE_DEDUP_MS = 30000;
let lastPage: { pathname: string; at: number } | undefined;
// Signup intentionally does not live in this generic mapping. Its Google Ads
// conversion carries enhanced-conversion user data and a stable transaction
// id, so it must go through trackSignupConversion() after the server confirms
// account creation. Keeping email_submitted/account_created out of CV prevents
// a button click, failed request, env label, or route remount from double-firing
// the primary Sign-up conversion.
const CV: Record<string,string|undefined> = {
  review_completed: import.meta.env.VITE_GOOGLE_CV_REVIEW,
  checkout_started: import.meta.env.VITE_GOOGLE_CV_CHECKOUT,
  subscription_purchased: import.meta.env.VITE_GOOGLE_CV_SUBSCRIPTION,
};

export async function initAnalytics(cfg: AnalyticsConfig): Promise<void> {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  try {
    if (cfg.tiktokPixelId) {
      // Codex final-fold Blocker 1 (comment 5300270649): while the URL still
      // carries a sensitive app query (token/session_id/code/next/…), DEFER
      // the TikTok third-party script load. The consuming route scrubs the URL
      // (child effects run before this root effect — confirm/redeem scrub on
      // mount; login/pricing/consultations scrub once the fetch resolves);
      // flushDeferredPixels() then loads the pixel on the clean URL. The SSR
      // head already omitted the Google loader/bootstrap for the same pages.
      if (hasSensitiveQuery(location.search)) {
        pendingPixelId = cfg.tiktokPixelId;
      } else {
        loadTikTokPixel(cfg.tiktokPixelId);
      }
    }

    // The canonical Google tag is bootstrapped synchronously in __root.tsx's
    // shared document head. Do not inject /metrics/ here: that first-party
    // gateway's gtg_health=1 chain returned Google's health-check stub and
    // silently dropped every conversion request.
    // Initial page view. Fired here (not from the onResolved subscription)
    // because the router's first `onResolved` has already happened by the
    // time the root component mounts — so exactly one page_view fires on
    // first load, and route changes below fire the rest.
    // Fix 3 (audit 85fbc48d): a ttclid redirect hop (/login?ttclid=X →
    // /?ttclid=X) or an auth-gate bounce sets a sessionStorage flag before
    // the redirect; when THIS load is that hop, skip the initial
    // page_view/page_enter — the final landing page fires its own below, so a
    // ttclid ad click records exactly ONE page_view + ONE page_enter.
    let skipInitialPv = false;
    try {
      if (sessionStorage.getItem("bys_ttclid_redirect")) {
        sessionStorage.removeItem("bys_ttclid_redirect");
        // Fix 3 follow-up (2026-08-13): the hop's root effect often does NOT
        // run before location.replace() navigates away, so the flag survives
        // to the FINAL landing page — and treating a stale flag as "skip this
        // page_view" recorded ZERO page_views and no session row for every
        // TikTok ad click. Only the hop itself (/login?ttclid=…) skips; any
        // other path is the real landing and MUST fire its page_view.
        skipInitialPv = location.pathname === "/login";
      }
    } catch { /* sessionStorage unavailable — no suppression */ }
    if (!skipInitialPv) trackPageView();
    // Session-play scroll sampling: one passive listener, rAF-throttled, ~1.5s
    // cadence with a ≥2pt depth delta. Runs for the page lifetime.
    initScrollSampling();
    // Live-presence heartbeat (owner 2026-08-13): while the tab is visible,
    // beacon a lightweight sp_ping every 60s (+ once 2s after load) so the
    // /owner "Live now" board shows real presence — bys_sessions.last_ts stays
    // fresh and a visitor quietly reading a page stays "active" instead of
    // drifting to "idle". sp_ rows are replay-only: they never enter bys_events,
    // so the funnel and today counts stay clean.
    const heartbeat = () => {
      try {
        if (typeof document === "undefined" || document.visibilityState !== "visible") return;
        persistEvent("sp_ping", { path: location.pathname });
      } catch { /* tracking must never break the page */ }
    };
    window.setTimeout(heartbeat, 2000);
    window.setInterval(heartbeat, 60000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") heartbeat(); });
  } catch {
    /* tracking must never break the page */
  }
}

// SPA route-change tracking. TanStack Router emits `onResolved` after each
// client-side navigation completes (link clicks, back/forward, search changes).

// Official TikTok base-code equivalent: ttq must be an ARRAY with deferred
// methods (not a plain object) or TikTok's events.js won't pick up events.
// Mirrors TikTok's own snippet, then loads the pixel. No ttq.page() here on
// purpose: the pixel must fire exactly once per page load, and trackPageView()
// is the single fire point (it runs on every load via initAnalytics's tail and
// on every route change, and skips the ttclid redirect hop so ad clicks aren't
// double-counted).
let pendingPixelId: string | undefined; // TikTok pixel deferred (dirty URL at init)
function loadTikTokPixel(pixelId: string): void {
  try {
    const w = window;
    const ttqMethods = [
      "page", "track", "identify", "instances", "debug", "on", "off",
      "once", "ready", "alias", "group", "enableCookie", "disableCookie",
      "holdConsent", "revokeConsent", "grantConsent",
    ];
    const holder = w as unknown as { ttq?: unknown; TiktokAnalyticsObject?: unknown };
    // TikTok's official snippet sets the global pointer FIRST. events.js
    // line 1 runs `window[window.TiktokAnalyticsObject]._env = ...` and
    // crashes with "Cannot set properties of undefined (setting '_env')"
    // sitewide when the pointer is missing (QA bd99fbf8).
    if (typeof holder.TiktokAnalyticsObject === "undefined") {
      holder.TiktokAnalyticsObject = "ttq";
    }
    const existing = holder.ttq;
    if (
      existing &&
      !Array.isArray(existing) &&
      typeof (existing as { load?: unknown }).load === "function"
    ) {
      // The TikTok SDK already initialized itself (its script won the load
      // race). Never clobber the real SDK with a stub — just make sure our
      // pixel is loaded. (Load-order race guard.)
      (existing as { load: (id: string) => void }).load(pixelId);
    } else {
      // ttq must stay duck-typed loose (any): the real TikTok SDK object and
      // our deferred-method stub share no common shape, and strict typing
      // keeps rejecting both (TS2352/TS2769). Casts below keep it safe.
      let ttq: any = Array.isArray(existing) ? existing : undefined;
      if (!ttq) {
        ttq = [] as any;
        holder.ttq = ttq;
      }
      const setAndDefer = (m: string) => {
        ttq[m] = function (...args: any[]) {
          ttq.push([m].concat(args));
        };
      };
      ttqMethods.forEach(setAndDefer);
      ttq.load = function (id: string) {
        const r = "https://analytics.tiktok.com/i18n/pixel/events.js";
        ttq._i = ttq._i || {};
        ttq._i[id] = [];
        ttq._t = ttq._t || {};
        ttq._t[id] = +new Date();
        const s = document.createElement("script");
        s.type = "text/javascript";
        s.async = true;
        s.src = r + "?sdkid=" + id + "&lib=ttq";
        const first = document.getElementsByTagName("script")[0];
        first?.parentNode?.insertBefore(s, first);
      };
      ttq.load(pixelId);
    }
  } catch {
    /* tracking must never break the page */
  }
}

// Re-initialize the Google tag on a page whose SSR head omitted it (a
// sensitive-query page). Idempotent: no-ops if gtag is already a function or a
// loader script is already in the document (a clean SSR page always has one).
function injectGoogleTagIfNeeded(): void {
  try {
    if (typeof window === "undefined" || typeof window.gtag === "function") return;
    if (document.querySelector('script[src*="googletagmanager.com/gtag/js"]')) return;
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`;
    document.head.appendChild(s);
    const boot = document.createElement("script");
    boot.text = GOOGLE_TAG_BOOTSTRAP;
    document.head.appendChild(boot);
  } catch {
    /* tracking must never break the page */
  }
}

// Codex final-fold Blocker 1: once a sensitive-query page has been scrubbed
// clean (the consuming route's history.replaceState), initialize the deferred
// third-party measurement on the clean URL — TikTok pixel + Google loader/
// bootstrap — BEFORE any page payload fires. While the URL is still dirty this
// no-ops and waits for the next clean opportunity (a route's track() call or
// the next navigation's trackPageView).
// P0 hotfix (work order 5300912458): Google recovery is INDEPENDENT of the
// TikTok pending state — a clean actual browser URL idempotently bootstraps the
// Google tag REGARDLESS of whether a TikTok pixel was ever deferred (previously
// `if (!pendingPixelId) return;` starved Google recovery on every clean page
// that had no pending TikTok pixel — e.g. pages whose SSR load failed or whose
// config carried no TikTok id). TikTok loads independently below, only when one
// is actually pending.
function flushDeferredPixels(): void {
  try {
    if (typeof window !== "undefined" && hasSensitiveQuery(window.location.search)) return;
  } catch {
    return; // can't inspect the URL — keep waiting
  }
  injectGoogleTagIfNeeded();
  if (pendingPixelId) {
    const id = pendingPixelId;
    pendingPixelId = undefined;
    loadTikTokPixel(id);
  }
}

function visitorId(): string {
  const found = document.cookie.match(/(?:^|;\s*)bys_vid=([^;]+)/)?.[1];
  if (found) return found;
  const id = crypto.randomUUID();
  document.cookie = `bys_vid=${id}; Max-Age=31536000; Path=/; SameSite=Lax`;
  return id;
}
function persistEvent(event: string, data: Record<string, unknown>) {
  try {
    // Conversion mapping: email_submitted persists as email_captured (the funnel
    // step). subscription_purchased is NOT mapped to "paid" anymore — the SERVER
    // write in handleCheckoutConfirm is the single source of truth for `paid`
    // (audit 85fbc48d Fix 5); the Google tag ping for subscription_purchased
    // still fires from track() above.
    const name = event === "email_submitted" ? "email_captured" : event;
    // Metrics 2.0: client-derived dt (ms since previous row) + t (ms since
    // session start) from the monotonic session clock — the server stores them
    // so the /owner playback shows real second-by-second durations. The session
    // clock seeds lazily here on the very first dispatch (the first page_view).
    const meta = { ...data, dt: sessionDt(), t: sessionT() };
    const payload = JSON.stringify({ vid: visitorId(), name, plan: typeof data.plan === "string" ? data.plan : undefined, meta });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/events", new Blob([payload], { type: "text/plain" }));
    else void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true });
  } catch { /* analytics must never break the app */ }
}

// Ad params moved OUT of the persisted page name into meta.attribution (audit
// 85fbc48d Fix 1): ttclid/gclid/gbraid/wbraid are the paid-traffic IDs,
// gad_* are Google Ads click/campaign params, gad_source is Google's automatic
// click-source param. The funnel/playback paths stay clean ("/login"), while the
// params still ride along for the session row's first-write-wins attribution.
const AD_PARAMS = ["ttclid","gclid","gbraid","wbraid","gad_source","gad_campaignid","gad_campaign","gad_adgroupid","gad_creative","gad_network","gad_device","gad_targetid","gad_placement","gad_interest","gad_keyword","gad_loc_interest","gad_loc_physical","gad_extension","gad_feeditemid","gad_target","gad_aceid","gad_cell","gad_audience","gad_clickid"];

// ── Track A security hotfix (Codex consolidated order 5294958539) ────────────
// Analytics/pixel deny-by-default: generic track() persists first-party ONLY.
// These coarse, non-sensitive events are the explicit allowlist that may ALSO
// reach third-party ad measurement (TikTok ttq, gtag custom events, and the
// third-party-facing dataLayer). Everything else — intake/check-in answers,
// quiz grades, child/folder/rating/tone detail, organizer/sortpile/record
// health, drafts — stays first-party no matter who calls track().
const AD_MEASUREMENT_EVENTS = new Set<AnalyticsEvent>([
  "landing_page_visit", "landing_module_click", "hero_view", "hero_cta_click",
  "review_started", "review_completed", "review_failed",
  "email_submitted", "account_created", "login_success", "password_set",
  "pricing_viewed", "consultation_viewed", "checkout_started",
  "subscription_purchased", "topup_purchased", "sortpile_purchase",
  "attorney_prep_pack_purchase", "record_review_purchase", "consultation_purchased",
  "gift_code_created", "gift_redeem_view", "gift_redeemed",
  "special_offer_shown", "special_offer_accepted", "special_offer_dismissed",
  "trial_modal_shown", "trial_modal_yes", "trial_modal_no", "trial_started",
  "quota_cta_click", "plan_chip_click",
  "quota_wall_shown", "quota_wall_topup_click", "quota_wall_ultimate_click",
  "mode_switched", "analyze_started", "analyze_completed",
  "attach_locked_tap", "steady_sheet_shown", "attach_added", "attach_removed",
]);

// Keys that must never be persisted into first-party analytics rows: sensitive
// situation answers, credentials/payment identifiers, child/family identifiers,
// exchange assessments, raw continuation URLs, and cross-platform click IDs
// (click IDs belong only in the page_view attribution object — never inside
// another platform's event payload).
const NEVER_PERSIST_KEYS = new Set<string>([
  "q1", "q2", "q3", "answer", "answers", "email", "child", "gender", "next",
  "token", "session_id", "sessionId", "code", "giftCode", "draft", "text",
  "message", "value", "tone", "promo", "rec", "recommendation",
  "landingPath", "rawPath",
  ...AD_PARAMS,
]);

// Behavioral assessment keys stripped from third-party payloads even when the
// event IS allowlisted. Track A P0 #2 (Codex final-fold): assessment values are
// structural usage ONLY — they never leave the app at all (see SAFE_PERSIST_KEYS).
const NEVER_AD_KEYS = new Set<string>(["score", "band", "folder", "gap", "label", "coverage", "gaps", "missing"]);

// GLOBAL key allowlist for persisted metadata — NOT a per-event schema (Codex
// final-fold Blocker 3, comment 5300418383): only these structural keys may
// persist, and the generic scrubber below accepts primitive values only
// (unknown/future keys are dropped, not stored — never a silent denylist).
// Track A P0 #2 (Codex final-fold comment 5300270649 Blocker 2): quiz/assessment
// VALUES (score/band) and assessment-detail keys (label/gap/coverage/gaps/
// missing — record-health grades, lamp labels, date-range gaps) are structural
// usage ONLY: they flow through the quiz/panel response itself and are NEVER
// analytics metadata, client-persisted or server-ingested. `q` (question
// index) and `folder` (structural classifier) remain.
const SAFE_PERSIST_KEYS = new Set<string>([
  "dt", "t", "sp", "kind", "path", "referrer", "attribution",
  "step", "variant", "source", "mode", "auth", "example", "status", "timeout",
  "interval", "tier", "intro", "count", "n", "chars", "remaining", "module",
  "edit", "target", "context", "item", "week", "plan", "q", "folder",
  "dest", "filed", "needsSorting", "skipped", "total", "campaign",
]);

// Bounded per-event metadata (Codex final-fold Blocker 3, comment 5300418383):
// the ONLY places a non-primitive / constrained-string value may persist —
// layered on top of the global allowlist above, never a generic array/object
// pass-through. Enumerations are EXACTLY what the emitting code sends (no
// wildcards):
//   checkout_wallet_available.methods — detectWalletMethods() emits apple_pay /
//     google_pay (method category only; Link is a Stripe-hosted-side method and
//     cannot be probed client-side).
//   funnel_started.entry — the four funnel call sites emit review (ReviewTool),
//     post-review (GuidedFunnel), intake (login), pricing (pricing).
const CHECKOUT_WALLET_METHODS = new Set(["apple_pay", "google_pay"]);
const FUNNEL_ENTRY_SLUGS = new Set(["review", "post-review", "intake", "pricing"]);

function pickSafeMeta(event: AnalyticsEvent, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (NEVER_PERSIST_KEYS.has(k) || !SAFE_PERSIST_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v;
    } else if (k === "attribution" && typeof v === "object" && !Array.isArray(v)) {
      // Attribution object passes through allowlisted only (AD_PARAMS).
      const att: Record<string, string> = {};
      for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
        if (AD_PARAMS.includes(ak) && typeof av === "string") att[ak] = av;
      }
      if (Object.keys(att).length) out.attribution = att;
    }
  }
  // Narrow event-specific validation (Codex final-fold Blocker 3, comment
  // 5300418383): the ONLY arrays/constrained strings that may persist, and only
  // on the exact events that emit them. Anything else — even a plausible-
  // looking slug or method name — is dropped. The generic boundary above stays
  // primitive-only; this is the single documented exception.
  if (event === "checkout_wallet_available" && Array.isArray(data.methods)) {
    const methods = [...new Set(data.methods.filter((m): m is string => typeof m === "string" && CHECKOUT_WALLET_METHODS.has(m)))];
    if (methods.length) out.methods = methods;
  } else if (event === "funnel_started" && typeof data.entry === "string" && FUNNEL_ENTRY_SLUGS.has(data.entry)) {
    out.entry = data.entry;
  }
  // login_success: the raw `next` URL is NEVER stored — record only a safe
  // destination category (pathname, query/hash stripped).
  if (event === "login_success" && typeof data.next === "string") {
    let dest = "home";
    try {
      const p = new URL(data.next, typeof location !== "undefined" ? location.origin : "https://beforeyousend.org").pathname;
      dest = p === "/home" ? "home" : p.startsWith("/pricing") ? "pricing" : p.startsWith("/redeem") ? "redeem" : p.startsWith("/consultations") ? "consultations" : p.startsWith("/onboarding") ? "onboarding" : "other";
    } catch { /* keep home */ }
    if (dest !== "home") out.dest = dest;
  }
  // Intake/check-in answer events: record the structural step only — never the
  // answer value itself.
  const stepMatch = /^(login_intake|checkin)_q([123])_answered$/.exec(event);
  if (stepMatch) out.step = Number(stepMatch[2]);
  return out;
}

function toAdSafeMeta(safe: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(safe)) {
    if (NEVER_AD_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// Sanitize document.referrer for persistence/attribution: same-origin
// referrers reduce to pathname; external referrers reduce to origin — never
// query or hash.
function sanitizeReferrer(ref: string): string | undefined {
  if (!ref) return undefined;
  try {
    const u = new URL(ref);
    const same = typeof location !== "undefined" && u.origin === location.origin;
    return same ? u.pathname : u.origin;
  } catch {
    return ref.split(/[?#]/)[0] || undefined;
  }
}

// UI state params that are safe to keep in a page URL for third-party page
// payloads — KEY + EXACT STRUCTURAL VALUE only (P0 hotfix, work order
// 5300912458): a known key carrying an unrecognized value is treated as dirty
// (third-party measurement suppressed) instead of trusted, and a key with no
// real current URL use is NOT listed here. The list is the union of every
// value each route actually reads today:
//   tab     — /home?tab=ai|case|action|organizer|sort|log|timeline|saved|tools
//             (home.tsx initial tab), /pricing?tab=One-time|Compare|FAQ
//             (pricing.tsx deep links from Tools cards / landing)
//   checkin — /pricing?checkin=50 (Co-Parent Check-In offer)
//   example — /?example=1 (landing scroll-to-review demo)
//   sort    — /home?tab=organizer&sort=1 (organizer sort state)
//   mode    — /home?mode=analyze|review (AI Co-Parent two-mode deep link)
//   ok      — /tiktok-connected?ok=1 (OAuth landing success state)
// Everything else non-attribution (token/session_id/code/next/plan/…)
// suppresses third-party page payloads until the route scrubs the URL.
const SAFE_UI_VALUES: Record<string, ReadonlySet<string>> = {
  tab: new Set(["ai", "case", "action", "organizer", "sort", "log", "timeline", "saved", "tools", "One-time", "Compare", "FAQ"]),
  checkin: new Set(["50"]),
  example: new Set(["1"]),
  sort: new Set(["1"]),
  mode: new Set(["analyze", "review"]),
  ok: new Set(["1"]),
};

// Exported scrub helper: is this (key, value) pair safe to keep in a visible
// URL for third-party measurement? Ad-attribution params are allowlisted as a
// separate dedicated set; UI params require the EXACT known value.
export function isCleanQueryParam(k: string, v: string): boolean {
  if (AD_PARAMS.includes(k)) return true;
  const allowed = SAFE_UI_VALUES[k];
  return !!allowed && allowed.has(v);
}

// Sensitive-query detection shared by the client page-view guard and the SSR
// head decision (__root.tsx getAnalyticsConfig): while the URL carries any
// query key/value that is NOT a known ad-attribution param or a known safe UI
// value (token, session_id, gift code, auth/reset secrets, raw next, unknown
// values under known keys, …), third-party measurement must NOT boot — the
// consuming route captures the credential and scrubs the URL, and only then
// does measurement initialize on the clean URL. The server-function SSR
// detector (getRequestUrl) may return sensitive:true systemically on clean
// routes — that conservative SSR omission is acceptable because clean-browser
// recovery (flushDeferredPixels → injectGoogleTagIfNeeded) restores
// measurement on the actual clean URL.
export function hasSensitiveQuery(search: string): boolean {
  if (!search || search === "?") return false;
  try {
    const q = new URLSearchParams(search);
    for (const [k, v] of q) {
      if (!isCleanQueryParam(k, v)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function trackPageView(path?: string): void {
  try {
    if (typeof window === "undefined") return;
    // Codex final-fold Blocker 1: if this page loaded dirty (sensitive query —
    // SSR omitted the Google loader, TikTok deferred) and the route has since
    // scrubbed the URL, bootstrap measurement NOW on the clean URL so the
    // payload below is the first thing the pixels see.
    flushDeferredPixels();
    // Fix 3 follow-up (2026-08-13): a redirect flag still set when this fires
    // means a bounce/hop navigation is mid-flight (auth-gate /home → / lands
    // here via SPA nav — initAnalytics already counted the route that really
    // rendered). Skip the landing page_view so a bounce records exactly ONE
    // page_view + ONE page_enter, not two. The ttclid hop itself never reaches
    // this function (initAnalytics skips it); the hop's own flag is consumed
    // here only if a route-change fired while a redirect was in flight.
    try {
      if (sessionStorage.getItem("bys_ttclid_redirect")) {
        sessionStorage.removeItem("bys_ttclid_redirect");
        return;
      }
    } catch { /* sessionStorage unavailable — no suppression */ }
    // Track A (Codex consolidated order §3): analytics/replay paths are
    // PATHNAME ONLY — never raw URLs. Query strings never persist; ad
    // attribution rides in the dedicated allowlisted attribution object.
    const pathname = path ?? location.pathname;
    const raw = new URLSearchParams(location.search);
    const attribution: Record<string, string> = {};
    for (const k of AD_PARAMS) { const v = raw.get(k); if (v) attribution[k] = v; }
    // Fix 3: dedup on PATHNAME within 30s per tab (query variations collapse;
    // the ttclid redirect hop + final landing page collapse; a real revisit to a
    // DIFFERENT path still counts).
    const now = Date.now();
    if (lastPage && lastPage.pathname === pathname && now - lastPage.at < PAGE_DEDUP_MS) return;
    lastPage = { pathname, at: now };
    // Pixel page-view guard: while the URL carries any non-attribution /
    // non-UI query param (token, session_id, code, next, unknown on /confirm,
    // /pricing, /consultations, /redeem, /login), ALL third-party page payloads
    // are skipped until the route scrubs the URL. First-party persistence
    // (pathname-only) is unaffected.
    const dirty = hasSensitiveQuery(location.search);
    if (!dirty) {
      if (typeof window.gtag === "function") {
        window.gtag("event", "page_view", { page_path: pathname });
      }
      // TikTok ttclid landing (login.tsx): TikTok ad clicks land on
      // /login?ttclid=… and are immediately window.location.replace'd to
      // /?ttclid=… (full reload). Skip ttq.page() on that intermediate /login
      // page so the pixel fires exactly ONCE — on the final landing page —
      // instead of doubling every TikTok ad page_view. (The page_view event
      // still persists for the funnel; only the pixel double-fire is wrong.)
      const loginTtclidRedirect =
        pathname === "/login" &&
        /[?&]ttclid=/.test(location.search) &&
        !/[?&]next=/.test(location.search);
      if (typeof window.ttq?.page === "function" && !loginTtclidRedirect) {
        window.ttq.page();
      }
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "page_view", page_path: pathname });
    }
    // True external referrer: the server-side session referrer is always the
    // current page URL (same-origin API calls), so the only honest external
    // referrer is document.referrer, captured here on the first page_view.
    // Track A: referrer is sanitized (same-origin pathname / external origin —
    // never query/hash); the raw landing URL is no longer persisted anywhere.
    persistEvent("page_view", {
      path: pathname,
      referrer: sanitizeReferrer(document.referrer || ""),
      ...(Object.keys(attribution).length ? { attribution } : {}),
    });
    // Metrics 2.0: page enter for the playback timeline (deduped per pathname).
    onPageEnter(pathname, attribution);
    if (import.meta.env?.DEV) {
      console.debug("[analytics] page_view", pathname);
    }
  } catch {
    /* tracking must never break the page */
  }
}

export function initRouteTracking(router: {
  subscribe: (event: "onResolved", fn: () => void) => () => void;
}): () => void {
  if (typeof window === "undefined") return () => {};
  // The initial onResolved fired before the root component mounted (loader
  // data is read at render), so this only catches subsequent navigations —
  // no double-fire on first load, which initAnalytics already recorded.
  return router.subscribe("onResolved", () => {
    trackPageView();
  });
}

export function track(event: AnalyticsEvent, data?: Record<string, unknown>): void {
  try {
    if (typeof window === "undefined") return;
    // Codex final-fold Blocker 1: same clean-URL bootstrap as trackPageView —
    // the scrub sites call track() right after history.replaceState, so this
    // is the "measurement starts on the clean URL" moment for those flows.
    flushDeferredPixels();
    const w = window;
    const payload = data ?? {};
    // P0 hotfix (work order 5300912458): the CURRENT browser dirty state gates
    // ALL third-party forwarding. First-party persistence stays allowed no
    // matter what; ttq / gtag / the third-party-facing dataLayer may only see
    // an event when the actual URL is clean (no sensitive query) AND the event
    // is in the explicit AD_MEASUREMENT_EVENTS allowlist. A track() call fired
    // while the URL still carries a credential (before the route scrubbed)
    // must not leak even an allowlisted event to ad measurement.
    const dirty = hasSensitiveQuery(window.location.search);
    // Track A (Codex consolidated order §1+§2): ALL events persist first-party
    // only, after central metadata scrubbing (pickSafeMeta — a global key
    // allowlist plus narrow per-event additions, not a giant denylist and not
    // an ad-facing schema). Only the explicit AD_MEASUREMENT_EVENTS allowlist
    // may also reach TikTok / gtag / the third-party-facing dataLayer, and even
    // then with the further-reduced ad-safe payload.
    const safe = pickSafeMeta(event, payload);
    if (!dirty && AD_MEASUREMENT_EVENTS.has(event)) {
      const adSafe = toAdSafeMeta(safe);
      if (typeof w.ttq?.track === "function") {
        try {
          w.ttq.track(event, adSafe);
        } catch {
          /* noop */
        }
      }
      const label = CV[event];
      if (label && typeof w.gtag === "function") w.gtag("event", event, { send_to: `${import.meta.env.VITE_GOOGLE_ADS_ID || "AW-18234635191"}/${label}`, ...adSafe });
      if (Array.isArray(w.dataLayer)) {
        w.dataLayer.push({ event, ...adSafe });
      }
    }
    persistEvent(event, safe);
    // Round-6: when a checkout starts, record whether this browser could pay
    // with a wallet — method category only, never customer data. Fired as a
    // separate event name so checkout_started's Google conversion mapping is
    // untouched. FIRST-PARTY ONLY (Codex final-fold Blocker 3, comment
    // 5300418383): checkout_wallet_available is deliberately NOT in
    // AD_MEASUREMENT_EVENTS — the coarse allowlist is the only path to TikTok /
    // gtag / dataLayer, so this event never touches third-party measurement and
    // persists through the same narrow event-specific validation as everything
    // else (pickSafeMeta bounds methods to the emitted method-category enum).
    if (event === "checkout_started") {
      const methods = detectWalletMethods();
      if (methods.length > 0) {
        persistEvent("checkout_wallet_available", pickSafeMeta("checkout_wallet_available", { methods }));
      }
    }
    if (import.meta.env?.DEV) {
      console.debug("[analytics]", event, safe);
    }
  } catch {
    /* noop */
  }
}

// Round-6 wallet-capability probe (method category only): Apple Pay via the
// native ApplePaySession API; Google Pay via PaymentRequest presence (the
// browser API Google Pay requires — a capability signal, not a GPay session).
// Link is a Stripe-hosted-side method and cannot be probed client-side.
function detectWalletMethods(): string[] {
  try {
    if (typeof window === "undefined") return [];
    const out: string[] = [];
    try {
      const w = window as unknown as { ApplePaySession?: { canMakePayments?: () => boolean } };
      if (typeof w.ApplePaySession !== "undefined" && w.ApplePaySession.canMakePayments?.()) out.push("apple_pay");
    } catch { /* detection must never break checkout */ }
    try {
      if ("PaymentRequest" in window) out.push("google_pay");
    } catch { /* noop */ }
    return out;
  } catch {
    return [];
  }
}

/**
 * Round-6 funnel events: fire ONCE per tab for events that must never
 * double-count (funnel_started / signup_started / signup_completed). A
 * sessionStorage flag survives SPA navigation and reloads; storage failure
 * degrades to fire-per-call-site and never blocks the caller.
 */
export function trackFunnelOnce(event: AnalyticsEvent, data?: Record<string, unknown>): void {
  try {
    const key = `bys_funnel:${event}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
  } catch { /* no storage — still fire; call sites are naturally once */ }
  track(event, data);
}

/**
 * Fires the one primary Google Ads Sign-up conversion after the server has
 * created/confirmed the account. The email is sent only through Google's
 * supported enhanced-conversion user_data interface; it is never added to the
 * site's persisted event payload or the generic dataLayer event object.
 */
export function trackSignupConversion(input: {
  email?: unknown;
  transactionId?: unknown;
}): void {
  try {
    if (typeof window === "undefined") return;
    const email = typeof input.email === "string"
      ? input.email.trim().toLowerCase()
      : "";
    const transactionId = typeof input.transactionId === "string"
      ? input.transactionId.trim()
      : "";
    if (!email || !transactionId || typeof window.gtag !== "function") return;

    // One conversion per account in this browser session. The server-provided
    // immutable account id is also sent as transaction_id so Google can dedupe
    // a legitimate retry across reloads/devices.
    const guardKey = `bys_google_signup:${transactionId}`;
    try {
      if (sessionStorage.getItem(guardKey)) return;
      sessionStorage.setItem(guardKey, "1");
    } catch {
      // Storage can be unavailable in hardened browsers; transaction_id still
      // gives Google an idempotency key, so the conversion remains safe.
    }

    window.gtag("set", "user_data", { email });
    window.gtag("event", "conversion", {
      send_to: GOOGLE_SIGNUP_DESTINATION,
      value: 1.0,
      currency: "USD",
      transaction_id: transactionId,
    });
  } catch {
    /* conversion tracking must never break signup */
  }
}
