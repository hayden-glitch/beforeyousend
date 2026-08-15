// Two-mode AI Co-Parent switcher (spec §1): a compact segmented control at the
// top of the review/analyze composer. Pure presentational — NO analytics inside;
// the parent fires mode_switched on change. Labels are fixed product strings
// ("Review a message" / "Analyze a situation"); the aria-label is the a11y name
// for the radiogroup ("AI Co-Parent mode") and never renders as visible copy.
//
// Rebuild per 5304729186 §4: compact controls, not oversized pills — a quiet
// segmented control (tight 12px radius, hairline border, recessed track,
// elevated active cell with a soft shadow), ≥44px targets, no flex-col
// squashing at tiny widths (labels wrap gracefully instead).

import type { ReactNode } from "react";
import { IconAnalyze, IconReview } from "./icons";

export type ToolMode = "review" | "analyze";

const OPTIONS: { value: ToolMode; label: string; Icon: (p: { className?: string }) => ReactNode }[] = [
  { value: "review", label: "Review a message", Icon: IconReview },
  { value: "analyze", label: "Analyze a situation", Icon: IconAnalyze },
];

export default function ModeSwitch({ mode, onChange }: { mode: ToolMode; onChange: (m: ToolMode) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="AI Co-Parent mode"
      className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-cream-deep p-1"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-lg px-2 py-2 text-center text-sm font-semibold leading-tight transition-colors duration-150 max-[360px]:gap-1.5 max-[360px]:text-[13px] ${
              active ? "bg-card text-forest shadow-card" : "text-stone hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
