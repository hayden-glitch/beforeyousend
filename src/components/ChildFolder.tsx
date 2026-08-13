// The child's folder — the emotional centerpiece of The Organizer (FRONT B).
// Owner batch 2 (Design 1, 2026-08-12): the folder OPENS AND STAYS. Tap opens
// the cover (600ms transform-only) and the open-folder bar pins at top: 5rem;
// the open body (Ratings + To-Do papers) renders below the scene in flow and
// stays until the dad closes it via the ✕ (or taps the cover again). No
// scroll-link, no park-away, no backdrop, no sheet — the previous
// useFolderOpen machinery is deleted.
//
// The scene renders OPEN by default in base CSS (--open: 1, "content visible
// by default" — no-JS / reduced-motion users get the open folder with the
// panels visible; React then drives --open from the `open` prop).
//
// Honesty rails: no claims here — decoration + the child's real name. Name is
// real DOM text (screen readers + not an image); stickers are aria-hidden.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prefersReducedMotion } from "~/lib/motion";
import { track } from "~/lib/analytics";
import "~/styles/folder.css";

export type ChildInfo = { name: string; gender?: "girl" | "boy"; id?: string };

type StickerSpec = { e: string; x: number; y: number; r: number; hero?: boolean };
type PackSpec = { face: string; accent: string; stickers: StickerSpec[] };

// B3/B5: deliberate fixed hexes — the child's world is constant across themes.
const PACKS: Record<"girl" | "boy" | "neutral", PackSpec> = {
  // Girls — "Unicorn Garden" (soft pink face)
  girl: {
    face: "#f6c9d9",
    accent: "#e58bb0",
    stickers: [
      { e: "🌈", x: 8, y: 10, r: -8 },
      { e: "🌸", x: 20, y: 78, r: 6 },
      { e: "💖", x: 70, y: 8, r: 10 },
      { e: "⭐", x: 60, y: 82, r: -6 },
      { e: "🦋", x: 91, y: 30, r: 12 },
      { e: "👑", x: 5, y: 44, r: -10 },
      { e: "🦄", x: 76, y: 58, r: -6, hero: true },
    ],
  },
  // Boys — "Space & Dinosaurs" (soft sky face)
  boy: {
    face: "#c7e3f5",
    accent: "#7fb5dd",
    stickers: [
      { e: "🪐", x: 8, y: 12, r: 8 },
      { e: "🦖", x: 18, y: 76, r: -6 },
      { e: "⭐", x: 68, y: 8, r: -10 },
      { e: "🚗", x: 58, y: 84, r: 8 },
      { e: "🛸", x: 90, y: 34, r: 12 },
      { e: "🌟", x: 6, y: 48, r: 10 },
      { e: "🚀", x: 74, y: 60, r: 6, hero: true },
    ],
  },
  // Neutral — "Sun & Stars" (kraft face; also the no-child folder)
  neutral: {
    face: "#e6cfa4",
    accent: "#b98f5f",
    stickers: [
      { e: "☀️", x: 8, y: 12, r: -6 },
      { e: "🌈", x: 18, y: 78, r: 6 },
      { e: "⭐", x: 70, y: 8, r: 8 },
      { e: "🎈", x: 62, y: 84, r: -8 },
      { e: "✨", x: 90, y: 32, r: 10 },
      { e: "🌟", x: 75, y: 60, r: -4, hero: true },
    ],
  },
};

// B4: per-letter palette cycles by index; every letter gets a white stroke.
const NAME_COLORS: Record<"girl" | "boy" | "neutral", string[]> = {
  girl: ["#e2568a", "#f28e2b", "#3fa7e8", "#8b5cf6", "#2fb57a"],
  boy: ["#2fa0e0", "#10b981", "#f59e0b", "#8b5cf6", "#f25f5c"],
  neutral: ["#e2568a", "#2fa0e0", "#f59e0b", "#10b981", "#8b5cf6"],
};

const TAP_MS = 650; // matches the 600ms transform-only cover/papers curve

function SceneLayers({ initial }: { initial?: string }) {
  return (
    <>
      <div className="child-folder-papers" aria-hidden="true">
        <span className="child-folder-peek" />
        <span className="child-folder-peek" />
        <span className="child-folder-tag a" />
        <span className="child-folder-tag b" />
        <span className="child-folder-sheet" />
        <span className="child-folder-sheet" />
        <span className="child-folder-sheet" />
      </div>
      <div className="child-folder-pocket" aria-hidden="true" />
      <div className="child-folder-cover" aria-hidden="true" />
      <div className="child-folder-tab" aria-hidden="true">{initial || ""}</div>
      <span className="child-folder-hint" aria-hidden="true">Tap to open</span>
    </>
  );
}

export default function ChildFolder({
  child,
  open,
  onToggleOpen,
  onOpenCapture,
  onEdit,
  paperCount,
}: {
  child: ChildInfo | null;
  open: boolean;
  onToggleOpen: () => void;
  onOpenCapture: () => void;
  onEdit: () => void;
  paperCount: number;
}) {
  // Decoration sequence: plays once per name CHANGE (null → name = first
  // decoration; name → name = edit). Never replays on remount (tab-switch) —
  // prevNameRef starts `undefined` so the first render is a no-op.
  const [decorating, setDecorating] = useState(false);
  const prevNameRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const name = child?.name || null;
    const prev = prevNameRef.current;
    prevNameRef.current = name;
    if (prev !== undefined && prev !== name && name && !prefersReducedMotion()) {
      setDecorating(true);
      const t = setTimeout(() => setDecorating(false), 1000);
      return () => clearTimeout(t);
    }
  }, [child?.name]);

  // Plan for analytics meta — the Organizer only mounts for Command/Ultimate,
  // but the folder doesn't receive the tier prop, so read it once per mount.
  const planRef = useRef("free");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j) return;
        planRef.current = j?.quota?.tier || j?.user?.profile?.tier || "free";
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const folderRef = useRef<HTMLButtonElement | null>(null);
  const reduced = prefersReducedMotion();
  // Batch 2: the `open` prop drives --open (1 = open). Base CSS is --open: 1,
  // so no-JS / reduced-motion starts open; JS + motion animates the change.
  useEffect(() => {
    const el = folderRef.current;
    if (!el) return;
    el.style.setProperty("--open", open ? "1" : "0");
  }, [open]);

  function handleTap() {
    const el = folderRef.current;
    if (!el) return;
    if (!reduced) {
      el.classList.add("tapping");
      window.setTimeout(() => el.classList.remove("tapping"), TAP_MS);
    }
    if (!open) track("organizer_folder_open", { plan: planRef.current });
    onToggleOpen();
  }

  const packKey: "girl" | "boy" | "neutral" =
    child?.gender === "girl" || child?.gender === "boy" ? child.gender : "neutral";
  const pack = PACKS[packKey];
  const colors = NAME_COLORS[packKey];
  const name = child?.name || "";
  const twoLine = name.length > 12;
  const mid = Math.ceil(name.length / 2);
  const line1 = twoLine ? name.slice(0, mid) : name;
  const line2 = twoLine ? name.slice(mid) : "";
  const initial = name.charAt(0).toUpperCase();

  const letters = (text: string, offset: number) =>
    text.split("").map((ch, i) => (
      <span
        key={`${offset}-${i}`}
        className="fn-letter"
        style={{ color: colors[(offset + i) % colors.length], "--i": String(offset + i) } as CSSProperties}
      >
        {ch}
      </span>
    ));

  const childAria = `${child?.name || ""}'s folder${paperCount ? ` — ${paperCount} paper${paperCount === 1 ? "" : "s"}` : ""}`;

  if (!child) {
    // B7: kraft folder (no stickers, no name, tab blank) + one calm line.
    // The line is a SIBLING under the scene in normal flow (fix for the Phase 1
    // paint bug: inside the button it painted behind the opaque pocket/cover
    // layers). Both the folder and the line open the capture sheet.
    return (
      <div className="child-folder-wrap">
        <div className="child-folder-scene">
          <button
            type="button"
            onClick={onOpenCapture}
            className="child-folder child-folder-capture"
            aria-label="Add your child's name"
            style={{ "--face": PACKS.neutral.face, "--accent": PACKS.neutral.accent } as CSSProperties}
          >
            <SceneLayers />
          </button>
          <button
            type="button"
            onClick={onOpenCapture}
            className="child-folder-capture-line"
            aria-hidden="true"
            tabIndex={-1}
          >
            This folder needs a name. Add your child's name — the folder becomes theirs.
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="child-folder-wrap">
      <div className="child-folder-scene">
        <button
          ref={folderRef}
          type="button"
          onClick={handleTap}
          className={`child-folder${decorating ? " decorating" : ""}`}
          aria-label={open ? childAria : `Open ${child.name}'s folder`}
          aria-expanded={open}
          style={{ "--face": pack.face, "--accent": pack.accent } as CSSProperties}
        >
          <SceneLayers initial={initial} />
          <div className={`child-folder-nameplate${twoLine ? " two-line" : ""}`} aria-hidden="true">
            <div className="child-folder-name">{letters(line1, 0)}</div>
            {line2 ? <div className="child-folder-name">{letters(line2, line1.length)}</div> : null}
            <span className="child-folder-underline" />
          </div>
          <div className="child-folder-stickers" aria-hidden="true">
            {pack.stickers.map((s, i) => (
              <span
                key={s.e}
                className="sticker"
                style={
                  {
                    left: `${s.x}%`,
                    top: `${s.y}%`,
                    "--r": `${s.r}deg`,
                    "--i": String(i),
                    fontSize: s.hero ? "2.6em" : "24px",
                  } as CSSProperties
                }
              >
                {s.e}
              </span>
            ))}
          </div>
        </button>
        <button type="button" onClick={onEdit} className="child-folder-edit" aria-label={`Edit ${child.name}'s folder`}>
          ✎
        </button>
      </div>
      {/* Batch 2: the open-folder bar. Fixed at top: 5rem (clears the sticky
          dashboard header); fades in only while this folder is open, so the
          folder "stays on screen" while the dad works the papers below. The
          ✕ is the calm collapse (reverse animation); the strip itself is not
          an action. */}
      <div className={`child-folder-parked-strip${open ? " is-open-folder" : ""}`} role="status" aria-live="polite">
        <span className="child-folder-parked-icon" aria-hidden="true">📁</span>
        <span className="child-folder-parked-text">
          {child.name}'s folder · {paperCount} paper{paperCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={onToggleOpen}
          className="child-folder-open-close"
          aria-label={`Close ${child.name}'s folder`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
