// "Case Summary" — a calm, factual overview of what the dad's OWN saved record
// shows right now (Communication Log, Event Timeline, Organizer documents,
// saved reviews). Part of Command Center (command/ultimate tiers; the server
// 402-gates it like the Document Organizer). No "AI" wording in user copy, no
// legal advice, no outcome promises: the text is generated from his own data,
// persists per user, and only regenerates when he taps the button.
//
// Rebuilt per 5304729186 §9: one professional generated document INSIDE the
// app — document title, updated date, concise sections, evidence/reference
// links, regenerate control. One elevated document surface on the dark
// workspace. No folder/folio illustration. Honest empty states throughout.

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { track } from "~/lib/analytics";
import {
  fetchCaseSummary,
  generateCaseSummary,
  type CaseSummaryCounts,
  type CaseSummaryRow,
} from "~/lib/caseSummary";
import { IconBook, IconLog, IconOrganizer, IconTimeline } from "./icons";

// Renders the generated text (LLM or fallback, both emit "### HEADER" + bullets
// + paragraphs) with the app's calm typography. Bullets group into one <ul>.
function SummaryText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      out.push(
        <ul key={key} className="mt-2 space-y-2">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-3 text-base leading-relaxed text-ink">
              <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-forest-soft" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  lines.forEach((l, i) => {
    const head = l.match(/^#{1,4}\s+(.+)$/);
    if (head) {
      flush("h" + i);
      out.push(
        <h3 key={"h" + i} className="mt-6 font-display text-xl font-semibold tracking-tight text-forest">
          {head[1]}
        </h3>
      );
      return;
    }
    const bullet = l.match(/^\s*[-•*]\s+(.+)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }
    if (!l.trim()) {
      flush("s" + i);
      return;
    }
    flush("p" + i);
    out.push(
      <p key={"p" + i} className="text-base leading-relaxed text-ink">
        {l}
      </p>
    );
  });
  flush("end");
  return <div>{out}</div>;
}

export default function CaseSummary({
  tier,
  onGoTo,
}: {
  tier: string;
  onGoTo?: (tab: "log" | "timeline" | "tools") => void;
}) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [summary, setSummary] = useState<CaseSummaryRow | null>(null);
  const [counts, setCounts] = useState<CaseSummaryCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const r = await fetchCaseSummary();
    if (r.ok) {
      setSummary(r.value.summary);
      setCounts(r.value.counts);
    } else {
      setErr(r.error);
      setSummary(null);
      setCounts(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    track("case_summary_view", { plan: tier });
    void load();
  }, [load, tier]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = await generateCaseSummary();
    if (r.ok) {
      setSummary(r.value.summary);
      if (r.value.counts) setCounts(r.value.counts);
      setFallback(!!r.value.fallback);
    } else {
      setErr(r.error);
    }
    setBusy(false);
  }

  const total = counts ? counts.log + counts.timeline + counts.docs + counts.reviews : 0;
  const refs: { icon: ReactNode; label: string; onClick?: () => void }[] = [
    { icon: <IconLog className="h-4 w-4" />, label: "Log", onClick: () => onGoTo?.("log") },
    { icon: <IconTimeline className="h-4 w-4" />, label: "Timeline", onClick: () => onGoTo?.("timeline") },
    { icon: <IconOrganizer className="h-4 w-4" />, label: "The Organizer", onClick: () => onGoTo?.("tools") },
  ];

  return (
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <IconBook className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Case Summary</p>
      </div>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-forest">Your situation, at a glance.</h2>
      <p className="mt-2 max-w-xl text-base leading-relaxed text-stone">
        One calm page built from what you've saved. Nothing more.
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
      ) : summary ? (
        <div className="card mt-6 overflow-hidden">
          {/* Document header: title + updated date */}
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4 sm:px-7">
            <h3 className="font-display text-xl font-semibold text-forest">Case Summary</h3>
            <span className="text-sm text-stone">
              Updated{" "}
              {new Date(summary.generatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>
          <div className="px-5 py-5 sm:px-7">
            <SummaryText text={summary.text} />
            {fallback && (
              <p className="mt-5 rounded-[14px] bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone">
                Built from your saved record in quick mode — the summary engine was briefly busy. Regenerate anytime for the full version.
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
          {/* Document footer: evidence references */}
          {counts && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-cream-deep/40 px-5 py-3 sm:px-7">
              <span className="text-sm text-stone">
                Drawn from {counts.log} log entries · {counts.timeline} timeline events · {counts.docs} documents · {counts.reviews} saved reviews
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {refs.map((r) =>
                  r.onClick ? (
                    <button key={r.label} onClick={r.onClick} className="chip min-h-9 px-2.5 py-1 text-sm">
                      {r.icon}
                      {r.label} →
                    </button>
                  ) : null
                )}
              </span>
            </div>
          )}
        </div>
      ) : total === 0 ? (
        <div className="card mt-6 p-6">
          <p className="text-lg font-semibold leading-snug text-forest">Your Case Summary starts with your saved records.</p>
          <p className="mt-2 text-base leading-relaxed text-stone">
            Add a log entry, timeline event, or document — this page turns what you save into a calm, factual overview.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {refs.map((r) =>
              r.onClick ? (
                <button key={r.label} onClick={r.onClick} className="chip min-h-11">
                  {r.icon}
                  {r.label} →
                </button>
              ) : null
            )}
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[14px] border border-forest/20 bg-cream-deep/60 p-6">
          <p className="text-lg font-semibold leading-snug text-forest">Your record is ready for a summary.</p>
          <p className="mt-1 text-base leading-relaxed text-stone">
            One tap turns what you've saved into a calm overview.
          </p>
          <button onClick={create} disabled={busy} className="btn-primary mt-5 w-full text-lg sm:w-auto">
            {busy ? "Working on it…" : "Create my Case Summary"}
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
        An organizing summary of what you've saved — not legal advice.
      </p>
    </section>
  );
}
