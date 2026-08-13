// Command Center tab bar (app-redesign-spec §2) — the mobile app-shell bottom
// navigation, and the desktop pill row that replaces it at ≥768px. Five tabs
// with real inline SVG icons and ≥56px hit targets; Tools shows active while
// the internal "organizer" deep-link tab is open (mapping done by home.tsx).

import type { ReactNode } from "react";
import { IconHistory, IconLog, IconReview, IconTimeline, IconTools } from "./icons";

export type TabKey = "ai" | "saved" | "log" | "timeline" | "tools";

const TABS: { key: TabKey; label: string; Icon: (p: { className?: string }) => ReactNode }[] = [
  { key: "ai", label: "Review", Icon: IconReview },
  { key: "saved", label: "History", Icon: IconHistory },
  { key: "log", label: "Log", Icon: IconLog },
  { key: "timeline", label: "Timeline", Icon: IconTimeline },
  { key: "tools", label: "Tools", Icon: IconTools },
];

function CountBadge({ n }: { n: number }) {
  return (
    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-forest px-1 text-[10px] font-semibold text-cream">
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function TabBar({
  active,
  onChange,
  savedCount,
}: {
  active: TabKey;
  onChange: (t: TabKey) => void;
  savedCount: number;
}) {
  return (
    <>
      {/* Mobile: fixed bottom bar (md:hidden) */}
      <nav
        aria-label="Command Center tabs"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream/95 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-5xl overflow-x-clip">
          {TABS.map(({ key, label, Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-current={isActive ? "page" : undefined}
                className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center px-1"
              >
                <span
                  className={`flex flex-col items-center gap-1 rounded-full px-3 py-1 transition-colors duration-150 ${
                    isActive ? "bg-forest/10 text-forest" : "text-stone"
                  }`}
                >
                  <Icon className="h-6 w-6 transition-transform duration-150 active:scale-[0.96]" />
                  <span className="flex max-w-full items-center gap-1 text-[11px] font-medium">
                    <span className="truncate">{label}</span>
                    {key === "saved" && savedCount > 0 && <CountBadge n={savedCount} />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Desktop: sticky pill row directly under the header */}
      <nav
        aria-label="Command Center tabs"
        className="sticky top-16 z-10 hidden border-b border-line bg-cream/95 backdrop-blur md:block"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-5 py-2">
          {TABS.map(({ key, label, Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full px-4 font-medium transition-colors duration-150 ${
                  isActive ? "bg-forest/10 text-forest" : "text-stone hover:bg-cream-deep"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
                {key === "saved" && savedCount > 0 && <CountBadge n={savedCount} />}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
