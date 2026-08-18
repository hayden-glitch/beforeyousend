// The child's space — the personalization anchor of The Organizer (FRONT B).
// Rebuilt per 5304729186 §7: NO folder illustration. The child's name, paper
// count, and an open control render as a calm, professional record row; the
// open body (Ratings + To-Do panels) renders in flow below it via
// FolderOpenPanel and stays until the dad closes it. All data hooks and
// analytics are preserved: child capture (Add / edit via ChildCaptureSheet),
// organizer_folder_open, and the per-child ratings/todos profiles.
//
// Honesty rails: the row shows the child's real name as DOM text; decoration
// is limited to a quiet initial monogram — no claims, no fake objects.

import { useEffect, useRef } from "react";
import { track } from "~/lib/analytics";

export type ChildInfo = { name: string; gender?: "girl" | "boy"; id?: string };

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
  // Plan for analytics meta — the Organizer only mounts for Command/Ultimate,
  // but the row doesn't receive the tier prop, so read it once per mount.
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

  const name = child?.name || "";
  const initial = name.charAt(0).toUpperCase() || "•";
  const paperLabel = `${paperCount} paper${paperCount === 1 ? "" : "s"} on record`;
  const rowAria = open
    ? `${name}'s space — ${paperLabel}. Close.`
    : `Open ${name}'s space — ${paperLabel}.`;

  if (!child) {
    return (
      <div className="rounded-[14px] border border-dashed border-line bg-cream-deep/50">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-forest">Make a space for your child</p>
            <p className="mt-0.5 text-sm text-stone">
              Add their name — notes, ratings, and to-dos get their own place.
            </p>
          </div>
          <button type="button" onClick={onOpenCapture} className="btn-primary min-h-11 shrink-0 px-5 text-base">
            Add child
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-line bg-card shadow-card">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            if (!open) track("organizer_folder_open", { plan: planRef.current });
            onToggleOpen();
          }}
          aria-label={rowAria}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-forest/15 text-lg font-semibold text-forest">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-ink">{name}</span>
            <span className="block text-sm text-stone">{paperLabel}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="icon-btn text-stone"
          aria-label={`Edit ${name}'s space`}
        >
          ✎
        </button>
        <button
          type="button"
          onClick={() => {
            if (!open) track("organizer_folder_open", { plan: planRef.current });
            onToggleOpen();
          }}
          className="icon-btn"
          aria-label={open ? `Close ${name}'s space` : `Open ${name}'s space`}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`h-5 w-5 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
