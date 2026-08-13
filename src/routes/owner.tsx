import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { IconArrowDown, IconArrowLeft, IconArrowUp } from "~/components/icons";

export const Route = createFileRoute("/owner")({
  head: () => ({
    meta: [
      { title: "Owner dashboard — Before You Send" },
      { name: "description", content: "Owner dashboard: customers, live visitors, and where they go." },
    ],
  }),
  component: OwnerPage,
});

// ---- Board data (owner 2026-08-13) ------------------------------------------
// Tabs: CUSTOMERS (default — meaningful customer actions: signups, paid,
// reviews completed, checkouts initiated, per-source funnel, latest signups),
// LIVE NOW (who is on the site right now), TRAILS (each visitor's path with
// per-page durations, last 24h), FUNNEL (step-to-step event funnel for the
// ads), and SIGNUPS (one row per account). Every number comes straight from
// the tables; nothing is estimated or fabricated.
type LiveVisitor = {
  vid: string;
  vidFull: string;
  path: string;
  entryPath: string;
  firstMs: number;
  lastMs: number;
  source: string;
  device: string;
  os: string;
  lastEvent: string;
};
type TrailStep = { path: string; durMs: number; ts: number };
type SessionTrail = {
  vid: string;
  vidFull: string;
  firstMs: number;
  lastMs: number;
  durationMs: number;
  pages: number;
  source: string;
  device: string;
  os: string;
  steps: TrailStep[];
};
type FunnelStep = { name: string; count: number; base: number | null; rate: number; drop: number; sampleTooSmall: boolean };
type Summary = {
  funnel: FunnelStep[];
  sessionsToday: number;
  uniqueVisitorsToday: number;
  eventsToday: number;
  dataHealth?: { eventsToday: number; sessionsToday: number; eventsPerSession: number; sessionsRawToday: number; botsFiltered: number };
  liveNow: LiveVisitor[];
  sessions: SessionTrail[];
};
type CustomerRow = {
  email: string;
  created: string;
  confirmed: boolean;
  source: string;
  sourceLabel: string;
  campaign: string;
  landing: string;
  tier: string;
  tierLabel: string;
  trial: "active" | "used" | "none";
  paid: boolean;
  createdToday: boolean;
};
type Customers = {
  rows: CustomerRow[];
  counts: { signupsToday: number; signupsTotal: number; paidToday: number; paidTotal: number; reviewsToday: number; reviewsTotal: number; checkoutsToday: number; checkoutsTotal: number };
  sourceSplit: { source: string; label: string; count: number }[];
  funnel: { source: string; label: string; signups: number; paid: number; base: number; sampleTooSmall: boolean }[];
  minSample: number;
};

const LABELS: Record<string, string> = {
  page_view: "Page view",
  review_started: "Review started",
  review_completed: "Review completed",
  login_intake_started: "Intake started",
  login_intake_completed: "Intake completed",
  email_captured: "Email captured",
  account_created: "Account created",
  login_success: "Signed in",
  checkout_started: "Checkout initiated",
  paid: "Paid",
  pricing_viewed: "Pricing viewed",
  consultation_viewed: "Consultations viewed",
  landing_page_visit: "Landed",
  special_offer_shown: "Special offer shown",
  special_offer_accepted: "Offer accepted",
  consultation_purchased: "Consultation purchased",
  topup_purchased: "Top-up purchased",
  timeline_entry_added: "Timeline entry added",
};
const pretty = (n: string) => LABELS[n] || n.replaceAll("_", " ");

// Human-readable page names for the boards — raw paths are still shown
// underneath so nothing is hidden.
const PATH_LABELS: Record<string, string> = {
  "/": "Home",
  "/pricing": "Pricing",
  "/login": "Sign in",
  "/consultations": "Consultations",
  "/dashboard": "Command Center",
  "/faq": "FAQ",
  "/about": "About",
  "/contact": "Contact",
  "/trust": "Trust",
  "/privacy": "Privacy",
  "/terms": "Terms",
  "/redeem": "Redeem a gift",
  "/quiz": "Co-parent quiz",
  "/account": "Account",
  "/onboarding": "Welcome",
  "/confirm": "Confirm email",
  "/verification": "Verification",
};
function pathLabel(p: string | null | undefined): string {
  if (!p) return "—";
  const base = p.split("?")[0];
  if (PATH_LABELS[base]) return PATH_LABELS[base];
  const s = base.replace(/^\/+/, "");
  return s ? s : "Home";
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
function timeAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
function localTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ---- Session-play replay (kept as the detail view) --------------------------
type PlayRow = { kind: string; name?: string; dt?: number; t?: number; depthPct?: number; path?: string; ts: string; meta?: Record<string, unknown> };
function fmtRel(ms: number | undefined): string {
  if (ms === undefined || isNaN(ms) || ms < 0) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  return `+${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
function fmtLater(ms: number | undefined): string {
  if (ms === undefined || isNaN(ms) || ms < 0) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 2) return "same moment";
  if (s < 60) return `${s}s later`;
  return `${Math.floor(s / 60)}m${s % 60}s later`;
}
function wallTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
function normalizePath(p: string): string {
  // Fix 1 (audit 85fbc48d): playback trails render the normalized page name —
  // pathname only (or pathname + non-ad query). Legacy rows carry the raw URL
  // (/login?gclid=X) and show as "/login"; new rows are sanitized client-side.
  return p.split("?")[0] || p;
}
function playLabel(p: PlayRow): string {
  if (p.kind === "page_enter") return `${p.path ? normalizePath(p.path) : "/"} — page enter`;
  if (p.kind === "page_exit") return `${p.path ? normalizePath(p.path) : "/"} — page exit`;
  if (p.kind === "scroll") return `scroll ${p.depthPct ?? "?"}%`;
  if (p.kind === "ping") return "still on page";
  if (p.name === "page_view") return p.path ? `page view — ${normalizePath(p.path)}` : "page view";
  return p.name ? pretty(p.name) : p.kind;
}
// Attribution chips for a playback row (Fix 1/4): source · campaign · gclid tail
// when the landing event carried ad params in its meta.
function playAttribution(p: PlayRow): string[] {
  const m = p.meta && typeof p.meta === "object" ? p.meta : {};
  const att = m.attribution && typeof m.attribution === "object" ? (m.attribution as Record<string, unknown>) : {};
  const has = (k: string) => typeof att[k] === "string" && !!att[k];
  const chips: string[] = [];
  if (has("gclid") || has("gad_source") || has("gad_campaignid")) chips.push("Google");
  else if (has("ttclid")) chips.push("TikTok");
  const cam = typeof att.gad_campaignid === "string" && att.gad_campaignid ? String(att.gad_campaignid) : "";
  if (cam) chips.push(`campaign ${cam}`);
  const g = typeof att.gclid === "string" && att.gclid ? String(att.gclid).slice(-6) : "";
  if (g) chips.push(`gclid …${g}`);
  return chips;
}
// Walk raw rows and split into visit segments: t is seeded per page load, so a
// return visit (t drops below the previous row's t) starts a new segment.
function buildPlaySegments(play: PlayRow[]): { p: PlayRow; rel?: number; wall: string; newVisit: boolean }[] {
  let segStart: number | undefined;
  let prevT: number | undefined;
  const out: { p: PlayRow; rel?: number; wall: string; newVisit: boolean }[] = [];
  for (const p of play) {
    const t = typeof p.t === "number" ? p.t : undefined;
    let newVisit = false;
    if (t !== undefined && prevT !== undefined && t < prevT) {
      newVisit = true;
      segStart = t;
    } else if (t !== undefined && segStart === undefined) {
      segStart = t;
    }
    out.push({ p, rel: t !== undefined && segStart !== undefined ? t - segStart : undefined, wall: wallTime(p.ts), newVisit });
    if (t !== undefined) prevT = t;
  }
  return out;
}

// ---- Test-account hiding (build 2, owner 2026-08-13) ------------------------
// Default ON, persisted in localStorage. Owner email is never filtered.
const HIDE_TEST_KEY = "bys_owner_hide_test";
function isTestEmail(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return true;
  if (e === "haydenxclark@gmail.com") return false; // owner — never hidden
  if (e.endsWith("@example.com")) return true;
  if (e.endsWith("@bys.test")) return true;
  if (e.startsWith("qa.")) return true;
  const local = e.split("@")[0] || "";
  if (local === "test" || local === "testing" || local === "fake" || local === "dummy") return true;
  return false;
}

type TabId = "customers" | "live" | "trails" | "funnel" | "signups";
const TABS: { id: TabId; label: string }[] = [
  { id: "customers", label: "Customers" },
  { id: "live", label: "Live now" },
  { id: "trails", label: "Session trails" },
  { id: "funnel", label: "Funnel" },
  { id: "signups", label: "Signups" },
];

function OwnerPage() {
  const [tab, setTab] = useState<TabId>("customers");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [customers, setCustomers] = useState<Customers | null>(null);
  const [available, setAvailable] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [hideTest, setHideTest] = useState<boolean>(() => {
    try { return localStorage.getItem(HIDE_TEST_KEY) !== "0"; } catch { return true; }
  });
  // Per-visitor drill-down: which vid is expanded + its cached session-play
  // replay, fetched from /api/metrics/visitor on first expand.
  const [expandedVid, setExpandedVid] = useState<string | null>(null);
  const [plays, setPlays] = useState<Record<string, PlayRow[]>>({});
  const [playLoading, setPlayLoading] = useState<Record<string, boolean>>({});
  const [timelineError, setTimelineError] = useState<string | null>(null);
  // Owner reset control (two-tap confirm, honest copy).
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const loadTimeline = (vidFull: string) => {
    if (plays[vidFull]) return;
    setTimelineError(null);
    setPlayLoading((prev) => ({ ...prev, [vidFull]: true }));
    fetch(`/api/metrics/visitor?vid=${encodeURIComponent(vidFull)}`, { credentials: "same-origin" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((x) => setPlays((prev) => ({ ...prev, [vidFull]: x.play || [] })))
      .catch(() => setTimelineError("Couldn't load this visitor's playback."))
      .finally(() => setPlayLoading((prev) => ({ ...prev, [vidFull]: false })));
  };

  const doReset = () => {
    if (resetting) return;
    if (!confirmReset) { setConfirmReset(true); return; }
    setResetting(true);
    setResetMsg(null);
    fetch("/api/metrics/reset", { method: "POST", credentials: "same-origin" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((x) => {
        setConfirmReset(false);
        setResetting(false);
        setResetMsg(
          `Cleared — ${x.wiped?.events ?? 0} events, ${x.wiped?.sessions ?? 0} sessions, ${x.wiped?.session_play ?? 0} playback rows removed. The board starts fresh from here.`
        );
        setPlays({});
        setExpandedVid(null);
        return fetch("/api/metrics/summary", { credentials: "same-origin" });
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => { if (x) { setSummary(x); setUpdated(new Date()); } })
      .catch(() => { setResetting(false); setResetMsg("Couldn't clear metrics just now — try again."); });
  };

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!active) return;
      fetch("/api/metrics/summary", { credentials: "same-origin" })
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then((x) => { if (active) { setSummary(x); setUpdated(new Date()); setAvailable(true); } })
        .catch(() => { if (active) setAvailable(false); });
      fetch("/api/metrics/customers", { credentials: "same-origin" })
        .then((r) => { if (!r.ok) return null; return r.json(); })
        .then((x) => { if (active && x) setCustomers(x); })
        .catch(() => { /* customers view is secondary; live boards still work */ });
    };
    load();
    // Live board: refresh every 10s, paused while the tab is hidden.
    const id = window.setInterval(() => { if (!document.hidden) load(); }, 10000);
    const tick = window.setInterval(() => setClock(Date.now()), 10000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { active = false; window.clearInterval(id); window.clearInterval(tick); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const toggleHideTest = (v: boolean) => {
    setHideTest(v);
    try { localStorage.setItem(HIDE_TEST_KEY, v ? "1" : "0"); } catch { /* noop */ }
  };

  const liveNow = summary?.liveNow || [];
  const sessions = summary?.sessions || [];
  const funnel = summary?.funnel || [];
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count || 0));
  const c = customers;
  const allRows = c?.rows || [];
  const rows = hideTest ? allRows.filter((r) => !isTestEmail(r.email)) : allRows;
  const todayRows = rows.filter((r) => r.createdToday);
  const signupsToday = todayRows.length;
  const signupsTotal = rows.length;
  const paidToday = todayRows.filter((r) => r.paid).length;
  const paidTotal = rows.filter((r) => r.paid).length;
  const sourceSplit = ["google", "tiktok", "direct", "other"].map((src) => ({
    source: src,
    label: src === "google" ? "Google" : src === "tiktok" ? "TikTok" : src === "direct" ? "Direct" : "Other",
    count: rows.filter((r) => r.source === src).length,
  }));
  const latestSignups = rows.slice(0, 10);
  const sourceFunnel = ["google", "tiktok", "direct"].map((src) => {
    const sig = todayRows.filter((r) => r.source === src);
    return {
      source: src,
      label: src === "google" ? "Google" : src === "tiktok" ? "TikTok" : "Direct",
      signups: sig.length,
      paid: sig.filter((r) => r.paid).length,
      base: todayRows.length,
      sampleTooSmall: (c?.minSample ?? 20) > 0 && todayRows.length < (c?.minSample ?? 20),
    };
  });

  return (
    <main id="main" tabIndex={-1} className="min-h-dvh bg-cream px-5 py-8 text-ink">
      <div className="mx-auto max-w-4xl">
        <a href="/" className="inline-flex items-center text-sm text-forest underline"><IconArrowLeft className="h-4 w-4" />Before You Send</a>
        <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-4xl font-semibold text-forest">Owner dashboard</h1>
          <p className="text-xs text-stone">{updated ? `Updated ${updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · every 10s` : ""}</p>
        </div>

        {!available ? (
          <div className="mt-6 rounded-2xl border border-line bg-card p-5">
            <p className="font-display text-lg font-semibold text-forest">Dashboard locked</p>
            <p className="mt-2 text-sm leading-relaxed text-stone">
              This dashboard is locked to the owner account. Sign in with the owner email to view it — and make sure
              you're on the same site address you signed in on (with or without www).
            </p>
          </div>
        ) : !summary ? (
          <p className="mt-6 text-stone">Loading…</p>
        ) : (
          <>
            {/* Tabs */}
            <nav aria-label="Dashboard sections" className="mt-6 flex flex-wrap gap-1.5">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
                    tab === t.id ? "bg-forest text-cream" : "border border-line bg-card text-stone hover:text-forest"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </nav>

            {/* ============ CUSTOMERS (default view) ============ */}
            {tab === "customers" ? (
              <>
                <section className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
                  {[
                    { label: "Signups", today: signupsToday, total: signupsTotal, note: "accounts" },
                    { label: "Paid", today: paidToday, total: paidTotal, note: "accounts with a paid plan" },
                    { label: "Reviews completed", today: c?.counts.reviewsToday ?? 0, total: c?.counts.reviewsTotal ?? 0, note: "review_completed events" },
                    { label: "Checkouts initiated", today: c?.counts.checkoutsToday ?? 0, total: c?.counts.checkoutsTotal ?? 0, note: "checkout_started events" },
                  ].map((card) => (
                    <div key={card.label} className="rounded-xl border border-line bg-card px-3 py-3">
                      <p className="font-display text-2xl leading-tight text-forest">
                        <span className="text-3xl">{card.today}</span>
                        <span className="text-lg text-taupe"> / {card.total}</span>
                      </p>
                      <p className="mt-0.5 text-[12px] font-semibold text-ink">{card.label}</p>
                      <p className="text-[11px] text-stone">{card.note} · today / total</p>
                    </div>
                  ))}
                </section>

                <section className="mt-5 rounded-2xl border border-line bg-card p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <h2 className="font-display text-xl font-semibold text-forest">Where signups come from — today</h2>
                      <p className="mt-0.5 text-sm text-stone">attribution stamped at signup from the visitor's session</p>
                    </div>
                    <button
                      onClick={() => toggleHideTest(!hideTest)}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-3 text-xs font-semibold text-stone hover:text-forest"
                      aria-pressed={hideTest}
                    >
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${hideTest ? "bg-forest" : "bg-line"}`} />
                      {hideTest ? "Hiding test accounts" : "Showing test accounts"}
                    </button>
                  </div>
                  {todayRows.length < (c?.minSample ?? 20) ? (
                    <p className="mt-4 rounded-xl border border-dashed border-line bg-cream p-4 text-sm text-stone">
                      Collecting data — {todayRows.length} attributed signup{todayRows.length === 1 ? "" : "s"} today (sample of {(c?.minSample ?? 20)} needed before the split is shown).
                    </p>
                  ) : (
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      {sourceFunnel.map((s) => (
                        <div key={s.source} className="rounded-xl border border-line bg-cream p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-stone">{s.label}</p>
                          <p className="mt-1 font-display text-2xl font-semibold text-forest">{s.signups}</p>
                          <p className="text-xs text-stone">{s.paid} paid</p>
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-stone">
                    Direct = typed the address or clicked a link without ad tags. Ad signups show the campaign below their email on the Signups tab.
                  </p>
                </section>

                <section className="mt-5 rounded-2xl border border-line bg-card p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-display text-xl font-semibold text-forest">Latest signups</h2>
                    <button onClick={() => setTab("signups")} className="inline-flex min-h-11 items-center rounded-full border border-forest px-4 text-sm font-semibold text-forest">
                      See all signups
                    </button>
                  </div>
                  {latestSignups.length ? (
                    <ul className="mt-3 space-y-1.5">
                      {latestSignups.map((r) => (
                        <li key={r.email} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line/60 pb-1.5 text-sm last:border-0">
                          <span className="min-w-0 max-w-full truncate font-semibold text-ink">{r.email}</span>
                          <span className="text-xs text-stone">· {localTime(r.created)}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.source === "google" ? "bg-emerald-100 text-emerald-900" : r.source === "tiktok" ? "bg-amber-100 text-amber-900" : "border border-line bg-cream-deep text-stone"}`}>
                            {r.sourceLabel}
                          </span>
                          {r.campaign ? <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-stone">{r.campaign}</span> : null}
                          {r.paid ? <span className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-semibold text-cream">{r.tierLabel}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-sm text-stone">No signups yet.</p>
                  )}
                </section>
              </>
            ) : null}

            {/* ============ LIVE NOW ============ */}
            {tab === "live" ? (
              <section className="mt-6 rounded-2xl border border-line bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-forest">Live now</h2>
                    <p className="mt-1 text-sm text-stone">everyone active in the last 15 minutes — where they are right now</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-forest px-3 py-1.5 font-display text-lg font-semibold text-cream">
                    <span aria-hidden="true" className={`h-2 w-2 rounded-full ${liveNow.length ? "animate-pulse bg-emerald-300" : "bg-cream/40"}`} />
                    {liveNow.length}
                  </span>
                </div>
                {liveNow.length ? (
                  <ul className="mt-4 space-y-2.5">
                    {liveNow.map((v) => {
                      const idleSec = Math.max(0, Math.floor((clock - v.lastMs) / 1000));
                      const active = idleSec < 90;
                      return (
                        <li key={v.vidFull} className="border-b border-line/60 pb-2.5 last:border-0">
                          <div className="flex items-start justify-between gap-x-3">
                            <span className="min-w-0">
                              <span className="font-semibold text-ink">{pathLabel(v.path)}</span>
                              <span className="mt-0.5 block truncate text-xs text-stone" title={v.path}>{v.path}</span>
                            </span>
                            <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-600" : "bg-amber-500"}`} />
                              {active ? "active now" : `idle ${Math.floor(idleSec / 60)}m`}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone">
                            <span className="font-medium text-ink">on site {fmtDur(clock - v.firstMs)}</span>
                            <span className="text-taupe">·</span>
                            <span className="rounded-full border border-line bg-cream-deep px-2 py-0.5">{v.device} · {v.os}</span>
                            {v.source ? <span className="rounded-full border border-line px-2 py-0.5">{v.source}</span> : null}
                            {v.entryPath ? <span className="truncate" title={v.entryPath}>came in via {pathLabel(v.entryPath)}</span> : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-line bg-cream p-6 text-center">
                    <p className="font-display text-lg font-semibold text-forest">No visitors right now.</p>
                    <p className="mt-1 text-sm text-stone">When someone opens the site, they'll appear here.</p>
                  </div>
                )}
              </section>
            ) : null}

            {/* ============ SESSION TRAILS ============ */}
            {tab === "trails" ? (
              <section className="mt-6 rounded-2xl border border-line bg-card p-5">
                <h2 className="font-display text-2xl font-semibold text-forest">Where people go & how long</h2>
                <p className="mt-1 text-sm text-stone">last 24 hours — tap a visitor for their page-by-page trail and second-by-second playback</p>
                {sessions.length ? (
                  <ul className="mt-4 space-y-2.5">
                    {sessions.map((s) => {
                      const open = expandedVid === s.vidFull;
                      const live = clock - s.lastMs < 15 * 60000;
                      const play = plays[s.vidFull];
                      return (
                        <li key={s.vidFull} className="border-b border-line/60 pb-2 last:border-0">
                          <button
                            onClick={() => { if (open) { setExpandedVid(null); } else { setExpandedVid(s.vidFull); loadTimeline(s.vidFull); } }}
                            aria-expanded={open}
                            className="flex min-h-11 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-left"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="font-mono text-sm font-semibold text-forest">{s.vid}</span>
                                {live ? <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-800"><span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" />on now</span> : null}
                                <span className="rounded-full border border-line bg-cream-deep px-2 py-0.5 text-xs text-stone">{s.device} · {s.os}</span>
                                {s.source ? <span className="rounded-full border border-line px-2 py-0.5 text-xs text-stone">{s.source}</span> : null}
                              </span>
                              <span className="mt-0.5 block text-xs text-stone">
                                {s.pages} page{s.pages === 1 ? "" : "s"} · started {timeAgo(s.firstMs)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-stone">
                              <span className="font-display text-lg font-semibold text-forest">{fmtClock(s.durationMs)}</span>
                              <span aria-hidden="true" className="text-taupe">{open ? <IconArrowUp className="h-4 w-4" /> : <IconArrowDown className="h-4 w-4" />}</span>
                            </span>
                          </button>
                          {open ? (
                            <div className="mt-2 space-y-3 rounded-xl border border-line bg-cream p-3 text-sm">
                              {/* Trail */}
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone">Trail · where they went</p>
                                {s.steps.length ? (
                                  <ul className="mt-2 space-y-1">
                                    {s.steps.map((st, i) => (
                                      <li key={i} className="flex items-baseline gap-x-2.5 border-b border-line/40 pb-1 last:border-0">
                                        <span className="w-12 shrink-0 text-right font-mono text-xs text-stone">{fmtClock(st.durMs)}</span>
                                        <span className="min-w-0 flex-1 truncate font-medium text-ink" title={st.path}>{pathLabel(st.path)}</span>
                                        {i === s.steps.length - 1 ? (
                                          <span className="shrink-0 text-xs text-stone">{live ? "still here" : "last page"}</span>
                                        ) : (
                                          <IconArrowDown className="h-3 w-3 shrink-0 text-taupe" />
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="mt-2 text-xs text-stone">No page views recorded.</p>
                                )}
                              </div>
                              {/* Playback (second-by-second, existing session-play) */}
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-stone">Playback · second by second</p>
                                {play ? (
                                  play.length < 2 ? (
                                    <p className="mt-2 text-xs text-stone">
                                      {play.length === 0 ? "No detailed playback yet for this visitor." : "Only 1 moment captured so far — playback builds as the visitor keeps using the site."}
                                    </p>
                                  ) : (
                                    <ul className="mt-2 space-y-1">
                                      {buildPlaySegments(play).map((row, i) =>
                                        row.newVisit ? (
                                          <li key={`div-${i}`} className="flex items-center gap-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-taupe">
                                            <span className="h-px flex-1 bg-line" />▲ New visit · {row.wall}
                                          </li>
                                        ) : (
                                          <li key={`row-${i}`} className="flex flex-wrap items-baseline gap-x-2 border-b border-line/40 pb-1 last:border-0">
                                            <span className="shrink-0 font-mono text-xs font-semibold text-forest">
                                              {row.rel !== undefined ? `[${fmtRel(row.rel)}]` : `[${row.wall}]`}
                                            </span>
                                            <span className="min-w-0 flex-1 font-medium capitalize text-ink">{playLabel(row.p)}</span>
                                            {playAttribution(row.p).length ? (
                                              <span className="flex shrink-0 flex-wrap gap-1">
                                                {playAttribution(row.p).map((ch) => (
                                                  <span key={ch} className="rounded-full border border-line bg-cream-deep px-1.5 py-0.5 font-mono text-[10px] text-stone">{ch}</span>
                                                ))}
                                              </span>
                                            ) : null}
                                            <span className="shrink-0 text-xs text-stone">· {row.p.dt !== undefined ? fmtLater(row.p.dt) : wallTime(row.p.ts)}</span>
                                          </li>
                                        )
                                      )}
                                    </ul>
                                  )
                                ) : (
                                  <button
                                    onClick={() => loadTimeline(s.vidFull)}
                                    className="mt-2 inline-flex min-h-11 items-center rounded-full border border-forest px-4 text-sm font-semibold text-forest"
                                  >
                                    {playLoading[s.vidFull] ? "Loading playback…" : "Show playback"}
                                  </button>
                                )}
                                {timelineError ? <p className="mt-2 text-xs text-red-800">{timelineError}</p> : null}
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-line bg-cream p-6 text-center">
                    <p className="font-display text-lg font-semibold text-forest">No sessions in the last 24 hours yet.</p>
                    <p className="mt-1 text-sm text-stone">Each visitor's path through the site will show up here.</p>
                  </div>
                )}
              </section>
            ) : null}

            {/* ============ FUNNEL ============ */}
            {tab === "funnel" ? (
              <section className="mt-6 rounded-2xl border border-line bg-card p-5">
                <h2 className="font-display text-2xl font-semibold text-forest">Funnel today</h2>
                <p className="mt-1 text-sm text-stone">step-to-step conversion for the ads</p>
                <div className="mt-4 space-y-2.5">
                  {funnel.map((step) => (
                    <div key={step.name} className="flex items-center gap-3 text-sm">
                      <span className="w-36 shrink-0 truncate" title={step.name}>{pretty(step.name)}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line/50">
                        <div className="h-full rounded-full bg-forest" style={{ width: `${Math.max(2, Math.round(((step.count || 0) / maxFunnel) * 100))}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right font-semibold text-forest">{step.count}</span>
                      <span className="w-20 shrink-0 text-right text-xs text-stone">
                        {step.sampleTooSmall ? "collecting data" : step.rate ? `${step.rate}%` : ""}
                      </span>
                    </div>
                  ))}
                  {!funnel.length ? <p className="text-xs text-stone">No events today yet.</p> : null}
                </div>
                <p className="mt-3 rounded-xl border border-line/60 bg-cream p-3 text-xs leading-relaxed text-stone">
                  Reviews completed is a separate path — ads land on /login (intake), so 0 reviews with N signups is expected.
                  Percentages appear once a step's base reaches a real sample.
                </p>
              </section>
            ) : null}

            {/* ============ SIGNUPS ============ */}
            {tab === "signups" ? (
              <section className="mt-6 rounded-2xl border border-line bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-forest">Signups</h2>
                    <p className="mt-1 text-sm text-stone">one row per account, newest first — attribution from the signup's own event and session</p>
                  </div>
                  <button
                    onClick={() => toggleHideTest(!hideTest)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-stone hover:text-forest"
                    aria-pressed={hideTest}
                  >
                    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${hideTest ? "bg-forest" : "bg-line"}`} />
                    {hideTest ? "Hide test accounts" : "Show test accounts"}
                  </button>
                </div>

                {/* Summary counts */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-line bg-cream px-3 py-2.5">
                    <p className="font-display text-xl leading-tight text-forest">{signupsToday} <span className="text-sm text-taupe">/ {signupsTotal}</span></p>
                    <p className="mt-0.5 text-[11px] text-stone">Signups today / total</p>
                  </div>
                  <div className="rounded-xl border border-line bg-cream px-3 py-2.5">
                    <p className="font-display text-xl leading-tight text-forest">{paidToday} <span className="text-sm text-taupe">/ {paidTotal}</span></p>
                    <p className="mt-0.5 text-[11px] text-stone">Paid today / total</p>
                  </div>
                  <div className="rounded-xl border border-line bg-cream px-3 py-2.5">
                    <p className="mt-0.5 flex flex-wrap gap-1">
                      {sourceSplit.filter((s) => s.count > 0 || s.source === "other").map((s) => (
                        <span key={s.source} className="rounded-full border border-line bg-card px-2 py-0.5 text-[11px] text-stone">{s.label} {s.count}</span>
                      ))}
                    </p>
                    <p className="mt-1 text-[11px] text-stone">Source split (all time)</p>
                  </div>
                </div>

                {rows.length ? (
                  <ul className="mt-4 space-y-2">
                    {rows.map((r) => (
                      <li key={r.email} className="border-b border-line/60 pb-2 text-sm last:border-0">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 break-all font-semibold text-ink">{r.email}</span>
                          {r.paid ? (
                            <span className="rounded-full bg-forest px-2 py-0.5 text-[11px] font-semibold text-cream">{r.tierLabel}</span>
                          ) : (
                            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-stone">{r.tierLabel}</span>
                          )}
                          {r.trial === "active" ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">trial active</span> : null}
                          {r.trial === "used" ? <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone">trial used</span> : null}
                          <span className="rounded-full border border-line bg-cream-deep px-2 py-0.5 text-[11px] text-stone">{r.confirmed ? "confirmed" : "unconfirmed"}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone">
                          <span>joined {localTime(r.created)}</span>
                          <span className="text-taupe">·</span>
                          <span className={`font-semibold ${r.source === "google" ? "text-emerald-800" : r.source === "tiktok" ? "text-amber-800" : ""}`}>{r.sourceLabel}</span>
                          {r.landing ? <span className="font-mono">{r.landing}</span> : null}
                          {r.campaign ? <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px]">{r.campaign}</span> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 text-sm text-stone">No signups yet.</p>
                )}
                <p className="mt-3 text-xs text-stone">
                  {hideTest
                    ? "Test accounts are hidden (QA, @example.com, @bys.test). Toggle above to see everything — the owner's own account is never hidden."
                    : "Showing every account, including QA/test accounts."}
                </p>
              </section>
            ) : null}

            {/* Footer — honesty note + owner reset */}
            <footer className="mt-10 space-y-3 border-t border-line pt-6">
              <p className="text-xs leading-relaxed text-stone">
                Every number here comes straight from the analytics tables. Automated/test traffic is excluded from visitor
                counts, and your own /owner visits are hidden from the boards. Raw daily counts are real people, not bots.
              </p>
              <div>
                {resetMsg ? <p className="mb-2 text-xs font-medium text-forest">{resetMsg}</p> : null}
                <button
                  onClick={doReset}
                  disabled={resetting}
                  className="inline-flex min-h-11 items-center text-xs text-stone underline decoration-line underline-offset-2 hover:text-ink disabled:opacity-60"
                >
                  {resetting ? "Clearing…" : confirmReset ? "Tap again to clear all metrics" : "Clear metrics"}
                </button>
                {confirmReset && !resetting ? (
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-stone">
                    This removes every visitor, event, and playback record. Accounts, reviews, and payments are not touched.
                  </p>
                ) : null}
              </div>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
