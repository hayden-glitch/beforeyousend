import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import { TONE_DISPLAY } from "~/lib/toneLabels";

// Calm-loop slice 2 — the weekly digest card (Steady+). One calm week-card for
// paid tiers (replaces Momentum under the one-week-card rule). Rolling 7-day
// window, same posture as Momentum: hidden entirely on an empty week (home.tsx
// gates the render), declining weeks show the numbers but never a criticism
// line, and the only trend copy is "Calmer than last week." / "Holding steady."
// — both grounded in the deterministic avg-score comparison. No animations.

type Props = {
  digest: any; // GET /api/digest body
  tier: string;
  onGoLog: () => void; // home.tsx: setTab("log")
};

export default function DigestCard({ digest, tier, onGoLog }: Props) {
  const week = digest?.week ?? {};
  const reviewed: number = Number(week.reviewed ?? 0);
  const sent: number = Number(week.sent ?? 0);
  const calmest = week.calmest ?? null;
  const stormiest = week.stormiest ?? null;
  const toneMix: Record<string, number> = week.toneMix ?? {};
  const recent: Array<{ score: number }> = Array.isArray(digest?.recent) ? digest.recent : [];
  const trend = digest?.trend ?? null;
  const scores = useMemo(
    () => recent.map((r) => Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)))),
    [recent]
  );

  // digest_view fires once per mount (ref guard).
  const viewFired = useRef(false);
  useEffect(() => {
    if (!viewFired.current) {
      viewFired.current = true;
      track("digest_view", { plan: tier });
    }
  }, [tier]);

  const [copied, setCopied] = useState(false);
  const [shareText, setShareText] = useState("");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  // §3.5 — exact shareable summary, built from the same digest data. First
  // person is the dad's own claim about his own account (not a founder story).
  const buildShareText = () => {
    const base = `This week I reviewed ${reviewed} message${reviewed === 1 ? "" : "s"} with Before You Send. Sent: ${sent}.`;
    const calmClause = calmest ? ` Calmest read: ${Number(calmest.score) || 0} of 100.` : "";
    return base + calmClause;
  };

  const share = async () => {
    const text = buildShareText();
    try {
      await navigator.clipboard.writeText(text);
      track("digest_share", { plan: tier });
      setShareText("");
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 3000);
    } catch {
      // Clipboard unavailable — reveal the text for a long-press copy. No error
      // copy, no crash.
      setCopied(false);
      setShareText(text);
    }
  };

  // Tone mix line: labels ascending, joined " · " — only when something went
  // out with a picker tone this week.
  const toneEntries = Object.entries(toneMix)
    .filter(([, n]) => Number(n) > 0)
    .sort(([a], [b]) => (TONE_DISPLAY[a] || a).localeCompare(TONE_DISPLAY[b] || b));
  const toneLine =
    sent > 0 && toneEntries.length
      ? `Tones that went out: ${toneEntries.map(([k, n]) => `${TONE_DISPLAY[k] || k} (${n})`).join(" · ")}`
      : null;

  return (
    <div className="card p-5">
      <p className="text-sm text-stone">Your week in messages</p>
      <p className="mt-1 font-display text-2xl font-semibold text-forest">
        {reviewed} reviewed · {sent} sent
      </p>

      {calmest && (
        <p className="mt-2 text-base text-stone">
          Calmest read {Number(calmest.score) || 0}
          {stormiest ? ` · Stormiest ${Number(stormiest.score) || 0}` : ""}
        </p>
      )}

      {toneLine && <p className="mt-1 text-base text-stone">{toneLine}</p>}

      {scores.length === 1 && (
        <p className="mt-3 text-base text-stone">Last message impact: <span className="tabular-nums">{scores[0]}</span> of 100</p>
      )}
      {scores.length >= 2 && (
        <div className="mt-3 border-t border-line pt-4">
          <p className="text-sm text-stone">Last 3 messages</p>
          <div className="mt-2 flex items-end gap-4">
            <svg
              viewBox="0 0 100 40"
              preserveAspectRatio="none"
              className="h-10 w-full text-forest"
              aria-hidden="true"
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={scores.map((s, i) => `${(i / (scores.length - 1)) * 100},${36 - (s / 100) * 32}`).join(" ")}
              />
              {scores.map((s, i) => (
                <circle
                  key={i}
                  cx={(i / (scores.length - 1)) * 100}
                  cy={36 - (s / 100) * 32}
                  r="2.6"
                  fill="currentColor"
                />
              ))}
            </svg>
          </div>
          <p className="mt-2 text-base font-medium text-forest">{scores.join(" → ")}</p>
        </div>
      )}

      {trend === "calmer" && (
        <p className="mt-3 text-base font-medium text-forest">Calmer than last week.</p>
      )}
      {trend === "steady" && (
        <p className="mt-3 text-base font-medium text-forest">Holding steady.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={share} className="btn-ghost min-h-11 text-forest">
          Share a summary
        </button>
        <button type="button" onClick={onGoLog} className="min-h-11 text-base font-semibold text-forest underline underline-offset-4">
          View Log →
        </button>
      </div>
      {copied && (
        <p role="status" className="mt-3 text-base text-stone">Copied — share it wherever you like.</p>
      )}
      {shareText && (
        <p className="mt-3 whitespace-pre-wrap rounded-2xl bg-cream-deep p-4 text-base leading-relaxed text-stone" role="status">
          {shareText}
        </p>
      )}
      <p className="mt-4 text-sm text-stone">A calm record of your week — it stays on your account.</p>
    </div>
  );
}
