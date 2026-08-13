// "Record health" — deterministic coverage snapshot (organizer-expansion spec
// §1, Slice 1). Command/Ultimate only; the server gates GET /api/record-health
// (402). Renders the ¾ progress ring (static fill — no stroke-dashoffset
// animation), the 30-day dots strip, 2–4 finding cards (coverage always; gap
// amber-soft; missing-doc ≤2 with an in-session dismiss; consistency only when
// true), the honest footer verbatim, and a calm empty state (≤2 items). A
// compact variant powers the Timeline-tab strip; the teaser card is the
// non-Command surface. Animation ~600ms on open (dots pop with a 24ms stagger,
// % rises, cards fade-slide) — the global prefers-reduced-motion rule in
// app.css zeroes it. No "AI" in user copy. Fail-open: any fetch error renders
// the calm empty shape, never an error wall.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { track } from "~/lib/analytics";

export type RecordHealthData = {
  ok: boolean;
  degraded?: boolean;
  coverage: { days: number; total: number; pct: number; band: string; positiveLine: string };
  gap: null | { from: string; to: string; length: number; fromLabel: string; toLabel: string; after: string; afterLabel: string };
  streak: null | number;
  consistency: null | { kind: string; topic: string; weeks: number; headline: string; body: string; sub: string };
  missing: { folder: string; folderLabel: string; quote: string; source: string; date: string; dateLabel: string; daysAgo: number }[];
  days30: boolean[];
  docs: number;
  totalRecords: number;
  empty: boolean;
  updatedAt: null | string;
};

const EMPTY_SNAPSHOT: RecordHealthData = {
  ok: true,
  coverage: { days: 0, total: 30, pct: 0, band: "Starting", positiveLine: "A record starts with one paper — you're doing it." },
  gap: null,
  streak: null,
  consistency: null,
  missing: [],
  days30: Array.from({ length: 30 }, () => false),
  docs: 0,
  totalRecords: 0,
  empty: true,
  updatedAt: null,
};

const RING_R = 50;
const RING_C = 2 * Math.PI * RING_R * 0.75; // ¾ arc length ≈ 235.6
// ¾ ring, opening at the bottom: start (24.6, 95.4) → sweep clockwise 270°.
const RING_D = "M 24.6 95.4 A 50 50 0 1 1 95.4 95.4";

function Ring({ pct, grayed }: { pct: number; grayed?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const fill = grayed ? 55 : clamped;
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" className={grayed ? "opacity-60" : ""} aria-hidden="true">
      <path d={RING_D} fill="none" stroke="var(--color-line, #e7e2d8)" strokeWidth="10" strokeLinecap="round" />
      <path
        d={RING_D}
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={RING_C}
        strokeDashoffset={RING_C * (1 - fill / 100)}
        className={grayed ? "text-stone/60" : "text-forest"}
      />
    </svg>
  );
}

function Dots({ days, mini }: { days: boolean[]; mini?: boolean }) {
  return (
    <div className={`flex justify-between ${mini ? "gap-0.5" : "gap-1"}`} aria-hidden="true">
      {Array.from({ length: 30 }).map((_, i) => (
        <span
          key={i}
          className={`bys-health-dot rounded-full ${mini ? "h-1.5 w-1.5" : "h-2.5 w-2.5"} ${days[i] ? "bg-forest" : "bg-line"}`}
          style={{ animationDelay: `${Math.min(i * 24, 600)}ms` }}
        />
      ))}
    </div>
  );
}

function fresh(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (isNaN(t)) return false;
  return Date.now() - t < 60_000;
}

async function fetchHealth(): Promise<RecordHealthData> {
  try {
    const r = await fetch("/api/record-health");
    if (!r.ok) return EMPTY_SNAPSHOT;
    const j = (await r.json().catch(() => null)) as RecordHealthData | null;
    return j && j.coverage ? j : EMPTY_SNAPSHOT;
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

/**
 * Full Record Health panel (Organizer browse view). `compact` switches to the
 * minimal Timeline-tab strip (no ring, no cards — pct + band + mini dots).
 */
export default function RecordHealthPanel({
  tier,
  compact,
  refreshKey,
  onLogGap,
  onAddPaper,
  onAddGapPaper,
  dismissed: propsDismissed,
  onDismiss,
}: {
  tier: string;
  compact?: boolean;
  refreshKey?: number | string;
  onLogGap?: (gap: NonNullable<RecordHealthData["gap"]>) => void;
  onAddPaper?: (folder: string) => void;
  onAddGapPaper?: (gap: NonNullable<RecordHealthData["gap"]>) => void;
  dismissed?: Record<string, boolean>;
  onDismiss?: (folder: string) => void;
}) {
  const [data, setData] = useState<RecordHealthData | null>(null);
  // "Not that one" dismissals (spec §1): hoisted by the host (home.tsx) so a
  // dismissed missing-doc card stays gone across tab switches and remounts for
  // the whole session. Local state is the fallback when no host prop is given
  // (the compact strip never renders these cards, so both paths are safe).
  const [localDismissed, setLocalDismissed] = useState<Record<string, boolean>>({});
  const dismissed = propsDismissed ?? localDismissed;
  const dismiss = (folder: string) => {
    if (onDismiss) onDismiss(folder);
    else setLocalDismissed((prev) => ({ ...prev, [folder]: true }));
  };
  const viewFired = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((d) => {
      if (cancelled) return;
      setData(d);
      if (!viewFired.current) {
        viewFired.current = true;
        track("record_health_view", {
          plan: tier,
          band: d.coverage.band,
          coverage: d.coverage.pct,
          gaps: d.gap ? 1 : 0,
          missing: d.missing.length,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [tier, refreshKey]);

  if (!data) {
    // First paint — quiet placeholder so nothing jumps.
    return (
      <div className="rounded-3xl border border-line bg-card p-5 shadow-card">
        <p className="text-base text-stone">Checking your record…</p>
      </div>
    );
  }

  if (compact) {
    const show = data.missing.length + (data.gap ? 1 : 0) + (data.consistency ? 1 : 0) > 0 || data.coverage.days > 0;
    if (!show) return null;
    return (
      <div className="mt-3 border-t border-line/70 pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Record health</p>
          <p className="text-base text-stone">
            {data.coverage.pct}% · {data.coverage.band}
            {data.streak ? ` · ${data.streak}-day streak` : ""}
          </p>
        </div>
        <div className="mt-2">
          <Dots days={data.days30} mini />
        </div>
        {fresh(data.updatedAt) && <p className="mt-1.5 text-xs text-stone">Updated just now</p>}
        <p className="mt-2 text-xs leading-relaxed text-stone">A snapshot of your record — not a legal assessment.</p>
      </div>
    );
  }

  const recency = (daysAgo: number) => (daysAgo <= 7 ? "this week" : "last week");
  const cards: { key: string; node: ReactNode }[] = [];

  if (data.empty) {
    // Empty state — ring renders, encouragement panel, no cards.
    cards.push({
      key: "empty",
      node: (
        <div className="rounded-3xl border border-line bg-cream-deep/60 p-5">
          <p className="text-lg font-semibold text-forest">A record starts with one paper.</p>
          <p className="mt-1 text-base leading-relaxed text-stone">
            You've got {data.docs} on file. Every paper you add makes the picture clearer — no pressure, one at a time.
          </p>
        </div>
      ),
    });
  } else {
    cards.push({
      key: "coverage",
      node: (
        <div className="rounded-3xl border border-line bg-card p-5 shadow-card">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Coverage</p>
          <p className="mt-1 text-base leading-relaxed text-ink">Records on {data.coverage.days} of the last {data.coverage.total} days.</p>
          <p className="mt-1 text-base leading-relaxed text-stone">
            {data.coverage.band} — {data.coverage.positiveLine}
          </p>
        </div>
      ),
    });
    if (data.gap && onLogGap) {
      cards.push({
        key: "gap",
        node: (
          <div className="rounded-3xl border border-amber-500/40 bg-amber-50 p-5">
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-amber-900">A quiet week</p>
            <p className="mt-1 text-base leading-relaxed text-ink">
              {data.gap.fromLabel}–{data.gap.toLabel} has no records.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => {
                  track("record_health_gap_log", { gap: `${data.gap!.fromLabel}–${data.gap!.toLabel}` });
                  onLogGap(data.gap!);
                }}
                className="min-h-11 text-base font-semibold text-amber-900 underline underline-offset-4"
              >
                Log it now →
              </button>
              {onAddGapPaper && (
                <button type="button" onClick={() => onAddGapPaper(data.gap!)} className="min-h-11 text-base text-amber-900 underline underline-offset-4">
                  Or add a paper from that week →
                </button>
              )}
            </div>
          </div>
        ),
      });
    }
    for (const m of data.missing) {
      if (dismissed[m.folder]) continue;
      cards.push({
        key: `missing-${m.folder}`,
        node: (
          <div className="rounded-3xl border border-line bg-card p-5 shadow-card">
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Worth adding</p>
            <p className="mt-1 text-base leading-relaxed text-ink">
              You mentioned the {m.quote} {recency(m.daysAgo)} — add the notice.
            </p>
            <p className="mt-1 text-sm text-stone">
              {m.source} · {m.dateLabel}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <button
                type="button"
                onClick={() => {
                  track("record_health_missing_add", { folder: m.folder });
                  onAddPaper?.(m.folder);
                }}
                className="min-h-11 text-base font-semibold text-forest underline underline-offset-4"
              >
                Add the paper →
              </button>
              <button
                type="button"
                onClick={() => dismiss(m.folder)}
                className="min-h-11 text-base text-stone underline underline-offset-4"
              >
                Not that one
              </button>
            </div>
          </div>
        ),
      });
    }
    if (data.consistency) {
      cards.push({
        key: "consistency",
        node: (
          <div className="rounded-3xl border border-forest/20 bg-cream-deep/60 p-5">
            <p className="text-base font-semibold text-forest">{data.consistency.headline}</p>
            <p className="mt-1 text-base leading-relaxed text-stone">{data.consistency.body}</p>
            <p className="mt-1 text-sm text-stone">{data.consistency.sub}</p>
          </div>
        ),
      });
    }
  }

  return (
    <div className="rounded-3xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Record health</p>
        {fresh(data.updatedAt) && <p className="text-sm text-stone">Updated just now</p>}
      </div>
      <div className="mt-3 flex flex-col items-center">
        <div className="relative flex h-[120px] w-[120px] items-center justify-center">
          <span className="text-forest">
            <Ring pct={data.coverage.pct} />
          </span>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="bys-health-pct font-display text-3xl font-semibold text-forest">{data.coverage.pct}%</p>
            <p className="bys-health-pct mt-0.5 text-sm font-medium text-stone" style={{ animationDelay: "120ms" }}>
              {data.coverage.band}
            </p>
          </div>
        </div>
        {data.streak ? (
          <p className="bys-health-card mt-3 text-sm font-medium text-forest">{data.streak}-day streak — keep it going.</p>
        ) : null}
      </div>
      <div className="mt-4">
        <Dots days={data.days30} />
      </div>
      {data.degraded ? <p className="mt-3 text-sm leading-relaxed text-stone">Couldn't refresh your snapshot right now — it'll be back shortly.</p> : null}
      <div className="mt-4 space-y-3">
        {cards.map((c, i) => (
          <div key={c.key} className="bys-health-card" style={{ animationDelay: `${Math.min(60 + i * 90, 600)}ms` }}>
            {c.node}
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-stone">A snapshot of your record — not a legal assessment.</p>
    </div>
  );
}

/** Non-Command teaser (Organizer tab / trial panel): decorative grayed-out
 *  ring, no data, calm copy, CTA → Command Center (fires organizer_upgrade
 *  + checkout_started via startCommandCheckout). Casual, zero warning. */
export function RecordHealthTeaser({ onGoCommand }: { onGoCommand?: () => void }) {
  return (
    <div className="rounded-3xl border border-line bg-card p-5 shadow-card">
      <div className="flex items-center gap-4">
        <span className="shrink-0">
          <Ring pct={0} grayed />
        </span>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-forest">See how complete your record is.</p>
          <p className="mt-1 text-base leading-relaxed text-stone">
            Command Center watches the gaps so you don't have to — 30 days at a glance.
          </p>
          <button
            type="button"
            onClick={() => {
              track("record_health_teaser_click", {});
              onGoCommand?.();
            }}
            className="mt-3 min-h-11 text-base font-semibold text-forest underline underline-offset-4"
          >
            See Command Center →
          </button>
        </div>
      </div>
    </div>
  );
}
