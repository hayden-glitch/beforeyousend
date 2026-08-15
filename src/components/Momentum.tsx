import { useMemo } from "react";

// Calm-loop slice 1 — the Momentum card: a rolling 7-day count of completed
// reviews ("N messages reviewed this week") + a last-3 sparkline with a gentle
// trend line. NOT a streak, no consecutive-day mechanics, no shame: the card is
// hidden entirely when there is no history (home.tsx), declining trends get no
// comment, and the only praise is a calm "Calmer than your last review."

type Props = {
  weekCount: number;
  recent: Array<{ id?: string; score: number; sentStatus?: string | null; sentTone?: string | null; createdAt?: string }>;
};

export default function Momentum({ weekCount, recent }: Props) {
  const scores = useMemo(() => recent.map((r) => Math.max(0, Math.min(100, Math.round(Number(r.score) || 0)))), [recent]);

  let trend: string | null = null;
  if (scores.length >= 2) {
    const first = scores[0];
    const last = scores[scores.length - 1];
    if (last > first) trend = "Calmer than your last review.";
    else if (last === first) trend = "Holding steady.";
  }

  return (
    <div className="card p-5">
      <p className="text-sm text-stone">This week</p>
      <p className="mt-1 font-display text-2xl font-semibold text-forest">
        {weekCount} message{weekCount === 1 ? "" : "s"} reviewed this week
      </p>
      {scores.length === 1 && (
        <p className="mt-3 text-base text-stone">Last message: {scores[0]}</p>
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
          {trend && <p className="mt-1 text-base text-stone">{trend}</p>}
        </div>
      )}
    </div>
  );
}
