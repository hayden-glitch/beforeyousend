// Theme switcher (app-redesign-spec §1.4) — two variants:
//   variant="popover" — icon-only 44×44 button opening a calm popover anchored
//     top-right (used in the Command Center header). role=radiogroup/radio.
//   variant="inline"  — three compact segmented pills (landing footer).
// Shared behavior: instant switch (no reload), persists to localStorage
// (bys_theme), updates the theme-color meta. Initial state reads the
// data-theme attribute set pre-hydration by the __root head script, so SSR
// never mismatches. Deliberately NO track() call (visual pass — the analytics
// event union is out of scope).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconCheck, IconLeaf, IconMoon, IconSun, IconTheme } from "./icons";

type ThemeId = "forest" | "midnight" | "sand";

const THEMES: { id: ThemeId; label: string; desc: string; Icon: (p: { className?: string }) => ReactNode }[] = [
  { id: "forest", label: "Forest", desc: "The original", Icon: IconLeaf },
  { id: "midnight", label: "Midnight", desc: "Calm & dark", Icon: IconMoon },
  { id: "sand", label: "Sand", desc: "Warm light", Icon: IconSun },
];

const META_COLORS: Record<ThemeId, string> = {
  forest: "#FAF7F1",
  midnight: "#0e1a15",
  sand: "#f6f1e6",
};

function currentTheme(): ThemeId {
  if (typeof document === "undefined") return "forest";
  const t = document.documentElement.getAttribute("data-theme");
  return t === "midnight" || t === "sand" ? t : "forest";
}

function applyTheme(t: ThemeId) {
  try {
    localStorage.setItem("bys_theme", t);
  } catch {
    /* storage unavailable — session-only theming still works */
  }
  document.documentElement.setAttribute("data-theme", t);
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", META_COLORS[t]);
}

export default function ThemeSwitcher({ variant }: { variant: "popover" | "inline" }) {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const select = useCallback((t: ThemeId) => {
    setTheme(t);
    applyTheme(t);
  }, []);

  // Outside click + Escape close the popover; focus returns to the button.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = e.target as Node | null;
      if (wrapRef.current && !wrapRef.current.contains(el)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  if (variant === "popover") {
    return (
      <div ref={wrapRef} className="relative">
        <button
          ref={btnRef}
          type="button"
          className="icon-btn"
          aria-label="Color theme"
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => setOpen((o) => !o)}
        >
          <IconTheme className="h-5 w-5" />
        </button>
        {open && (
          <div
            role="radiogroup"
            aria-label="Color theme"
            className="absolute right-0 top-[calc(100%+8px)] z-40 w-52 rounded-3xl border border-line bg-card p-2 shadow-pop"
          >
            {THEMES.map(({ id, label, desc, Icon }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    select(id);
                    setOpen(false);
                    btnRef.current?.focus();
                  }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors duration-150 ${
                    active ? "bg-forest/10" : "hover:bg-cream-deep"
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${active ? "bg-forest text-cream" : "bg-cream-deep text-forest"}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-ink">{label}</span>
                    <span className="block text-sm text-stone">{desc}</span>
                  </span>
                  {active && <IconCheck className="h-4 w-4 shrink-0 text-forest" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="inline-flex max-w-full flex-wrap rounded-[10px] border border-line bg-card p-1" role="group" aria-label="Color theme">
      {THEMES.map(({ id, label, Icon }) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => select(id)}
            className={`inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3.5 text-sm font-medium transition-colors duration-150 ${
              active ? "bg-forest text-cream" : "text-forest hover:bg-cream-deep"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
