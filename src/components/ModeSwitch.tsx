// Two-mode AI Co-Parent switcher (spec §1): a segmented pill at the top of the
// review/analyze composer. Pure presentational — NO analytics inside; the parent
// fires mode_switched on change. Labels are fixed product strings ("Review a
// message" / "Analyze a situation"); the aria-label is the a11y name for the
// radiogroup ("AI Co-Parent mode") and never renders as visible copy.

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
      className="grid grid-cols-2 gap-1 rounded-full border border-line bg-cream-deep p-1 max-[340px]:gap-0.5 max-[340px]:p-0.5"
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
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full px-2 text-sm font-semibold whitespace-normal text-center leading-tight transition-colors duration-150 max-[420px]:flex-col max-[420px]:gap-0.5 max-[420px]:px-1 max-[420px]:text-[11px] max-[340px]:px-0.5 max-[340px]:text-[10px] ${
              active ? "bg-forest text-cream" : "text-forest hover:bg-card"
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
