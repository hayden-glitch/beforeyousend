// "Action Center" — a calm, one-page "what needs your attention" list in the
// Command Center, built from the dad's OWN saved data (Communication Log, Event
// Timeline, Organizer documents, saved reviews, Case Summary). Part of Command
// Center (command/ultimate tiers; the server 402-gates it like the Document
// Organizer). No "AI" wording in user copy, no legal advice, no outcome
// promises. Four sections ALWAYS render with honest empty states; each item
// carries its source and a suggested next action (a real tab deep-link where
// feasible, honest copy otherwise). Persists per user; Regenerate refreshes it.
// One tiny ask → instant reward → casual regenerate.

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

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-cream-deep/60 px-4 py-3">
      <p className="font-display text-2xl font-semibold leading-none text-forest">{n}</p>
      <p className="mt-1.5 text-sm text-stone">{label}</p>
    </div>
  );
}

const SECTIONS: { key: ActionItem["section"]; label: string; blurb: string }[] = [
  { key: "unresolved", label: "Unresolved", blurb: "Things still open." },
  { key: "upcoming", label: "Upcoming", blurb: "Dates to keep in mind." },
  { key: "missing", label: "Missing", blurb: "Documents your record implies." },
  { key: "needs_documentation", label: "Needs documentation", blurb: "Worth writing down while it's fresh." },
];

function ItemCard({
  item,
  onGoTo,
}: {
  item: ActionItem;
  onGoTo?: (tab: "log" | "timeline" | "tools" | "organizer") => void;
}) {
  const tabRef = item.ref === "timeline" || item.ref === "log" || item.ref === "tools" || item.ref === "organizer" ? item.ref : undefined;
  return (
    <div className="rounded-2xl border border-line bg-cream-deep/40 px-4 py-3">
      <p className="text-base leading-relaxed text-ink">{item.text}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-stone">{item.source}</p>
        {item.actionType === "tab" && tabRef && onGoTo ? (
          <button onClick={() => onGoTo(tabRef)} className="chip whitespace-nowrap text-sm">
            {item.action} →
          </button>
        ) : (
          <span className="text-sm font-medium text-forest-soft">{item.action}</span>
        )}
      </div>
    </div>
  );
}

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

      {counts && (
        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4" role="list" aria-label="What your Action Center draws from">
          <Stat n={counts.log} label="Log entries" />
          <Stat n={counts.timeline} label="Timeline events" />
          <Stat n={counts.docs} label="Documents" />
          <Stat n={counts.reviews} label="Saved reviews" />
        </div>
      )}

      {loading ? (
        <div className="mt-6 rounded-3xl border border-line bg-card p-6 text-base text-stone">
          Reading your saved records…
        </div>
      ) : err && !summary ? (
        <div className="mt-6 rounded-3xl border border-line bg-card p-6">
          <p className="text-base leading-relaxed text-stone">{err}</p>
          <button onClick={load} className="btn-ghost mt-4 text-forest">
            Try again
          </button>
        </div>
      ) : summary && anyItems ? (
        <div className="mt-6 rounded-3xl border border-line bg-card p-6 shadow-card sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Your Action Center</p>
            <span className="text-sm text-stone">
              Generated {new Date(summary.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>

          {stale && (
            <p className="mt-4 rounded-2xl bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone">
              You've added to your record since this was generated — tap Regenerate below for an up-to-date list.
            </p>
          )}

          <div className="mt-5 space-y-6">
            {grouped.map((g) => (
              <div key={g.key}>
                <div className="flex items-baseline gap-2">
                  <h3 className="font-display text-xl font-semibold text-forest">{g.label}</h3>
                  <span className="text-sm text-stone">{g.blurb}</span>
                </div>
                {g.items.length ? (
                  <div className="mt-2 space-y-2">
                    {g.items.map((i) => (
                      <ItemCard key={i.id} item={i} onGoTo={onGoTo} />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-2xl border border-dashed border-line bg-cream-deep/30 px-4 py-3 text-sm leading-relaxed text-stone">
                    Nothing here yet — you're all clear.
                  </p>
                )}
              </div>
            ))}
          </div>

          {fallback && (
            <p className="mt-5 rounded-2xl bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone">
              Built from your saved record in quick mode — the review engine was briefly busy. Regenerate anytime for the full version.
            </p>
          )}

          {busy && (
            <p className="mt-5 flex items-center gap-2 rounded-2xl bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-forest-soft border-t-transparent" aria-hidden="true" />
              Working on it…
            </p>
          )}

          <button onClick={create} disabled={busy} className="btn-ghost mt-6 min-h-11 w-full text-forest sm:w-auto">
            {busy ? "Working on it…" : "Regenerate"}
          </button>
        </div>
      ) : summary ? (
        <div className="mt-6 rounded-3xl border border-line bg-card p-6 shadow-card">
          <p className="text-lg font-semibold leading-snug text-forest">Nothing needs your attention right now.</p>
          <p className="mt-2 text-base leading-relaxed text-stone">
            As you add log entries, timeline events, and documents, this page turns what you save into a calm list of what's unresolved, upcoming, missing, and worth documenting.
          </p>
          {total === 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {onGoTo && (
                <button onClick={() => onGoTo("log")} className="chip">
                  <IconLog className="h-5 w-5" />
                  Log →
                </button>
              )}
              {onGoTo && (
                <button onClick={() => onGoTo("timeline")} className="chip">
                  <IconTimeline className="h-5 w-5" />
                  Timeline →
                </button>
              )}
              {onGoTo && (
                <button onClick={() => onGoTo("tools")} className="chip">
                  <IconOrganizer className="h-5 w-5" />
                  The Organizer →
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6 rounded-3xl border border-forest/20 bg-cream-deep/60 p-6">
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
        <p role="alert" className="mt-4 rounded-2xl bg-cream-deep px-4 py-3 text-base text-stone">
          {err}
        </p>
      )}

      <p className="mt-6 text-sm leading-relaxed text-stone">
        An organizing list of what you've saved — not legal advice.
      </p>
    </section>
  );
}
