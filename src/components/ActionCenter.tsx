// "Action Center" — a calm, one-page "what needs your attention" list in the
// Command Center, built from the dad's OWN saved data (Communication Log, Event
// Timeline, Organizer documents, saved reviews, Case Summary). Part of Command
// Center (command/ultimate tiers; the server 402-gates it like the Document
// Organizer). No "AI" wording in user copy, no legal advice, no outcome
// promises.
//
// Rebuilt per 5304729186 §10: a restrained priority queue, not a dashboard
// widget wall. Four sections always render with honest empty states; each item
// carries its action, source, and a real tab deep-link where feasible. Dividers
// and typography; minimal color. Persists per user; Regenerate refreshes it.

import { useCallback, useEffect, useState } from "react";
import { track } from "~/lib/analytics";
import {
  fetchActionCenter,
  generateActionCenter,
  type ActionCenterCounts,
  type ActionCenterRow,
  type ActionItem,
} from "~/lib/actionCenter";
import { IconAction, IconLog, IconOrganizer, IconTimeline } from "./icons";

const SECTIONS: { key: ActionItem["section"]; label: string; blurb: string }[] = [
  { key: "unresolved", label: "Unresolved", blurb: "Things still open." },
  { key: "upcoming", label: "Upcoming", blurb: "Dates to keep in mind." },
  { key: "missing", label: "Missing", blurb: "Documents your record implies." },
  { key: "needs_documentation", label: "Needs documentation", blurb: "Worth writing down while it's fresh." },
];

export default function ActionCenter({
  tier,
  onGoTo,
}: {
  tier: string;
  onGoTo?: (tab: "log" | "timeline" | "tools" | "organizer") => void;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<ActionCenterRow | null>(null);
  const [counts, setCounts] = useState<ActionCenterCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [stale, setStale] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const r = await fetchActionCenter();
    if (r.ok) {
      setSummary(r.value.summary);
      setCounts(r.value.counts);
      setStale(!!r.value.stale);
    } else {
      setErr(r.error);
      setSummary(null);
      setCounts(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    track("action_center_view", { plan: tier });
    void load();
  }, [load, tier]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = await generateActionCenter();
    if (r.ok) {
      setSummary(r.value.summary);
      if (r.value.counts) setCounts(r.value.counts);
      setFallback(!!r.value.fallback);
      setStale(false);
    } else {
      setErr(r.error);
    }
    setBusy(false);
  }

  const total = counts ? counts.log + counts.timeline + counts.docs + counts.reviews : 0;
  const items = summary?.items || [];
  const grouped = SECTIONS.map((s) => ({ ...s, items: items.filter((i) => i.section === s.key) }));
  const anyItems = items.length > 0;

  return (
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <IconAction className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Action Center</p>
      </div>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-forest">What needs your attention.</h2>
      <p className="mt-2 max-w-xl text-base leading-relaxed text-stone">
        Built from what you've saved. Nothing more.
      </p>

      {loading ? (
        <div className="card mt-6 p-6 text-base text-stone">Reading your saved records…</div>
      ) : err && !summary ? (
        <div className="card mt-6 p-6">
          <p className="text-base leading-relaxed text-stone">{err}</p>
          <button onClick={load} className="btn-ghost mt-4 min-h-11 text-forest">
            Try again
          </button>
        </div>
      ) : summary && anyItems ? (
        <div className="card mt-6 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4 sm:px-7">
            <h3 className="font-display text-xl font-semibold text-forest">Action Center</h3>
            <span className="text-sm text-stone">
              Updated{" "}
              {new Date(summary.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>

          <div className="px-5 py-5 sm:px-7">
            {stale && (
              <p className="mb-5 rounded-[14px] bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone">
                You've added to your record since this was generated — tap Regenerate below for an up-to-date list.
              </p>
            )}

            {/* Restrained priority queue — sections with dividers, rows with
                action + source, one suggested next action per item. */}
            <div className="space-y-6">
              {grouped.map((g) => (
                <section key={g.key}>
                  <div className="flex items-baseline gap-2 border-b border-line/70 pb-1.5">
                    <h4 className="font-semibold text-ink">{g.label}</h4>
                    <span className="text-sm text-stone">{g.blurb}</span>
                    <span className="ml-auto text-sm text-taupe tabular-nums">{g.items.length}</span>
                  </div>
                  {g.items.length ? (
                    <div className="divide-y divide-line/60">
                      {g.items.map((i) => {
                        const tabRef =
                          i.ref === "timeline" || i.ref === "log" || i.ref === "tools" || i.ref === "organizer"
                            ? i.ref
                            : undefined;
                        return (
                          <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                            <p className="min-w-0 flex-1 text-base leading-relaxed text-ink">{i.text}</p>
                            <span className="text-sm text-stone">{i.source}</span>
                            {i.actionType === "tab" && tabRef && onGoTo ? (
                              <button onClick={() => onGoTo(tabRef)} className="chip min-h-11 whitespace-nowrap px-3 py-1.5 text-sm">
                                {i.action} →
                              </button>
                            ) : (
                              <span className="text-sm font-medium text-forest-soft">{i.action}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-3 text-sm leading-relaxed text-stone">Nothing here yet — you're all clear.</p>
                  )}
                </section>
              ))}
            </div>

            {fallback && (
              <p className="mt-5 rounded-[14px] bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone">
                Built from your saved record in quick mode — the review engine was briefly busy. Regenerate anytime for the full version.
              </p>
            )}

            {busy && (
              <p className="mt-5 flex items-center gap-2 rounded-[14px] bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-forest-soft border-t-transparent" aria-hidden="true" />
                Working on it…
              </p>
            )}

            <button onClick={create} disabled={busy} className="btn-ghost mt-6 min-h-11 w-full text-forest sm:w-auto">
              {busy ? "Working on it…" : "Regenerate"}
            </button>
          </div>
        </div>
      ) : summary ? (
        <div className="card mt-6 p-6">
          <p className="text-lg font-semibold leading-snug text-forest">Nothing needs your attention right now.</p>
          <p className="mt-2 text-base leading-relaxed text-stone">
            As you add log entries, timeline events, and documents, this page turns what you save into a calm list of what's unresolved, upcoming, missing, and worth documenting.
          </p>
          {total === 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onGoTo && (
                <button onClick={() => onGoTo("log")} className="chip min-h-11">
                  <IconLog className="h-5 w-5" />
                  Log →
                </button>
              )}
              {onGoTo && (
                <button onClick={() => onGoTo("timeline")} className="chip min-h-11">
                  <IconTimeline className="h-5 w-5" />
                  Timeline →
                </button>
              )}
              {onGoTo && (
                <button onClick={() => onGoTo("tools")} className="chip min-h-11">
                  <IconOrganizer className="h-5 w-5" />
                  The Organizer →
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 rounded-[14px] border border-forest/20 bg-cream-deep/60 p-6">
          <p className="text-lg font-semibold leading-snug text-forest">Your record is ready for its Action Center.</p>
          <p className="mt-1 text-base leading-relaxed text-stone">
            One tap — we'll turn what you've saved into a calm list of what needs your attention.
          </p>
          <button onClick={create} disabled={busy} className="btn-primary mt-5 w-full text-lg sm:w-auto">
            {busy ? "Working on it…" : "Build my Action Center"}
          </button>
          {busy && (
            <p className="mt-3 flex items-center gap-2 text-sm text-stone" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-forest-soft border-t-transparent" aria-hidden="true" />
              Working on it…
            </p>
          )}
        </div>
      )}

      {err && summary && (
        <p role="alert" className="mt-4 rounded-[14px] bg-cream-deep px-4 py-3 text-base text-stone">
          {err}
        </p>
      )}

      <p className="mt-6 text-sm leading-relaxed text-stone">
        An organizing list of what you've saved — not legal advice.
      </p>
    </section>
  );
}
