// Session Play — Metrics 2.0 (owner directive 2026-08-10).
//
// Second-by-second capture for the owner's per-visitor replay timeline:
//   · page_enter  — recorded on first page view of each path (SPA navigation)
//   · page_exit   — recorded on visibilitychange(hidden) / pagehide
//   · scroll      — throttled samples (~1.5s + ≥2pt delta, rAF-throttled)
//   · event rows  — every analytics event gets client-derived dt/t so the
//     replay shows ms-level durations, not estimates
//
// Everything here is best-effort and failure-proof: any throw is swallowed,
// no listener may ever break the funnel or the review flow. The session clock
// is a monotonic performance.now()-based clock seeded at the first dispatch
// (page_view), NOT Date.now() deltas — wall-clock jumps (tab backgrounding,
// NTP, user clock edits) would corrupt durations. Date.now() is used only as a
// fallback where performance.now() is unavailable.
//
// Rows are beaconed to POST /api/events with an `sp_` name prefix + meta.sp,
// where the server routes them to the bys_session_play table (never into the
// funnel/hourly/depth panels, which read bys_events only).

type PlayKind = "page_enter" | "page_exit" | "scroll" | "event";

let clockStart: number | null = null; // performance.now() at session seed
let lastT = 0;                        // session-ms of the previous dispatched row
// Fix 3 (audit 85fbc48d): page_enter dedups on PATHNAME within a 30s window —
// query-string variations of one route load collapse to a single enter, and the
// ttclid redirect hop collapses with its final landing page.
const ENTER_DEDUP_MS = 30000;
let enteredKey: { pathname: string; at: number } | null = null;
let currentPath = "/";
let scrollRaf = 0;
let lastScrollAt = 0;                 // session-ms of the previous scroll sample
let lastScrollDepth = -1;

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

/** Seed the session clock (idempotent). Called lazily by every capture path. */
export function ensureClock(): void {
  if (clockStart === null) {
    clockStart = nowMs();
    lastT = 0;
  }
}

/** Milliseconds since the session clock was seeded (monotonic, ≥ 0). */
export function sessionT(): number {
  ensureClock();
  return Math.max(0, Math.round(nowMs() - clockStart!));
}

/** Milliseconds since the previous dispatched row in this visitor session. */
export function sessionDt(): number {
  const t = sessionT();
  const dt = t - lastT;
  lastT = t;
  return dt;
}

function vid(): string {
  try {
    const found = document.cookie.match(/(?:^|;\s*)bys_vid=([^;]+)/)?.[1];
    if (found) return found;
    const id = crypto.randomUUID();
    document.cookie = `bys_vid=${id}; Max-Age=31536000; Path=/; SameSite=Lax`;
    return id;
  } catch {
    return "anon";
  }
}

function beacon(payload: Record<string, unknown>): void {
  try {
    if (typeof navigator === "undefined") return;
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "text/plain" }));
    } else {
      void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true });
    }
  } catch {
    /* session play must never break the app */
  }
}

/** Record one session-play row (sp_ names are replay-only server-side). */
function record(kind: PlayKind, name: string, extra: Record<string, unknown> = {}): void {
  try {
    ensureClock();
    const t = sessionT();
    const dt = t - lastT;
    lastT = t;
    beacon({
      vid: vid(),
      name,
      meta: { sp: true, kind, t, dt, path: currentPath, ...extra },
    });
  } catch {
    /* noop */
  }
}

/**
 * Page enter: called from analytics.trackPageView after each page_view persist.
 * Fixes 1+3 (audit 85fbc48d): dedupes on PATHNAME within a 30s window (route
 * changes with query-string variations — "/?x=1" vs "/" — collapse to one
 * enter), and rides the ad attribution (ttclid/gclid/…) into the enter row's
 * meta so the /owner playback can render source/campaign chips on the landing.
 */
export function onPageEnter(path: string, attribution?: Record<string, string>): void {
  try {
    const pathname = path.split("?")[0];
    const now = Date.now();
    if (enteredKey && enteredKey.pathname === pathname && now - enteredKey.at < ENTER_DEDUP_MS) return;
    enteredKey = { pathname, at: now };
    currentPath = path;
    record("page_enter", "sp_page_enter", { path, ...(attribution && Object.keys(attribution).length ? { attribution } : {}) });
  } catch {
    /* noop */
  }
}

/** Page exit: visibilitychange(hidden) + pagehide (sendBeacon delivers these). */
export function onPageExit(): void {
  try {
    record("page_exit", "sp_page_exit", { path: currentPath });
  } catch {
    /* noop */
  }
}

/**
 * Scroll sampling: one passive listener, rAF-throttled. Samples at most every
 * ~1.5s AND only when the depth moved ≥2pt (noise guard). `scrollend` flushes
 * the final position so a fast scroll that lands is still captured.
 */
export function initScrollSampling(): () => void {
  if (typeof window === "undefined") return () => {};
  const w = window;

  const depthNow = (): number => {
    try {
      const doc = document.documentElement;
      const max = doc.scrollHeight - w.innerHeight;
      return max > 0 ? Math.round((w.scrollY / max) * 100) : 0;
    } catch {
      return 0;
    }
  };

  const sample = () => {
    scrollRaf = 0;
    try {
      const depth = depthNow();
      const t = sessionT();
      if (t - lastScrollAt >= 1500 && Math.abs(depth - lastScrollDepth) >= 2) {
        lastScrollAt = t;
        lastScrollDepth = depth;
        record("scroll", "sp_scroll", { depthPct: depth });
      }
    } catch {
      /* noop */
    }
  };

  const onScroll = () => {
    if (!scrollRaf) scrollRaf = w.requestAnimationFrame(sample);
  };

  const onScrollEnd = () => {
    if (scrollRaf) {
      w.cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }
    try {
      const depth = depthNow();
      if (Math.abs(depth - lastScrollDepth) >= 2) {
        lastScrollDepth = depth;
        record("scroll", "sp_scroll", { depthPct: depth });
      }
    } catch {
      /* noop */
    }
  };

  const onHide = () => {
    try {
      if (document.visibilityState === "hidden") onPageExit();
    } catch {
      /* noop */
    }
  };

  w.addEventListener("scroll", onScroll, { passive: true });
  w.addEventListener("scrollend", onScrollEnd, { passive: true });
  w.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onHide);

  return () => {
    w.removeEventListener("scroll", onScroll);
    w.removeEventListener("scrollend", onScrollEnd);
    w.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onHide);
    if (scrollRaf) w.cancelAnimationFrame(scrollRaf);
  };
}
