// Command Center tab bar — the mobile app-shell bottom navigation, and the
// desktop tab row that replaces it at ≥768px. Five tabs with real inline SVG
// icons and ≥56px hit targets (≥44px required); Tools shows active while the
// internal "organizer" deep-link tab is open (mapping done by home.tsx).
//
// Dark app-shell style (5304729186 §3): low-profile, non-occluding, text-first
// with quiet icons; the selected state is brighter text + a 2px rule — never a
// filled pill. Content must clear the fixed bar (home.tsx pads the bottom).
// No overflow-x clipping — the five flex tabs shrink via min-w-0 + truncate.

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

function CountBadge({ n, active }: { n: number; active?: boolean }) {
  return (
    <span
      className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
        active ? "bg-cream text-forest" : "bg-forest text-cream"
      }`}
    >
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-cream/95 pb-[max(10px,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-5xl">
          {TABS.map(({ key, label, Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-current={isActive ? "page" : undefined}
                className="relative flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1"
              >
                {isActive && <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-b bg-forest" />}
                <span className={`flex max-w-full items-center gap-1 transition-colors duration-150 ${isActive ? "text-forest" : "text-stone"}`}>
                  <Icon className="h-6 w-6" />
                </span>
                <span className={`flex max-w-full items-center gap-1 text-[11px] font-medium transition-colors duration-150 ${isActive ? "text-ink" : "text-stone"}`}>
                  <span className="truncate">{label}</span>
                  {key === "saved" && savedCount > 0 && <CountBadge n={savedCount} active={isActive} />}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Desktop: sticky tab row directly under the header */}
      <nav
        aria-label="Command Center tabs"
        className="sticky top-16 z-10 hidden border-b border-line bg-cream/95 backdrop-blur md:block"
      >
        <div className="mx-auto flex max-w-5xl items-center gap-1 px-5">
          {TABS.map(({ key, label, Icon }) => {
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-current={isActive ? "page" : undefined}
                className={`relative inline-flex min-h-11 shrink-0 items-center gap-2 px-3 font-medium transition-colors duration-150 ${
                  isActive ? "text-ink" : "text-stone hover:text-ink"
                }`}
              >
                {isActive && <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 bg-forest" />}
                <Icon className="h-5 w-5" />
                {label}
                {key === "saved" && savedCount > 0 && <CountBadge n={savedCount} active={isActive} />}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
