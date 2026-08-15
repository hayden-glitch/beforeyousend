// Child name capture sheet (FRONT B, B7) — the one-tap path that turns the
// kraft folder into the child's folder. One field, two optional chips, one
// button — 3 taps max. Mirrors the P2 drawer pattern (fixed inset-0 z-40,
// backdrop bg-forest/25, .bys-sheet + .bys-grabber). Tiny ask → instant
// reward: "Make it theirs" → the folder decorates live in place.
//
// Honesty rails: chips are optional ("we just pick the stickers" — true, the
// gender only swaps the sticker pack); no claims, no urgency.

import { useEffect, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import { IconClose } from "./icons";
import type { ChildInfo } from "./ChildFolder";

export default function ChildCaptureSheet({
  open,
  initial,
  tier,
  onClose,
  onSaved,
  onRemoved,
}: {
  open: boolean;
  initial: ChildInfo | null;
  tier: string;
  onClose: () => void;
  onSaved: (children: ChildInfo[]) => void;
  onRemoved: (children: ChildInfo[]) => void;
}) {
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"girl" | "boy" | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setGender(initial?.gender);
    setBusy(false);
    setConfirmRemove(false);
    setErr("");
    // Focus after the sheet mounts (the backdrop/sheet animate in 240ms).
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [open, initial]);
  // Phase C (MWO 83): Escape closes the sheet — never a keyboard trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    if (busy) return;
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Batch 2: carry the child's stable id through edits (the server
          // preserves the existing slot's id on rename regardless).
          children: [{ id: initial?.id, name: n.slice(0, 40), ...(gender ? { gender } : {}) }],
          // Batch 1: editing pins the previous name so the server replaces
          // THIS slot instead of wiping siblings (merge, not full-replace).
          ...(initial ? { replaceName: initial.name } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j?.error === "string" ? j.error : "Couldn't save the name right now — please try again.");
        setBusy(false);
        return;
      }
      // Batch 2: the server is the source of truth — it assigns (add) or
      // preserves (rename) the child's stable id. Hand home the server's
      // children array, never a locally-built guess.
      const serverKids: ChildInfo[] = Array.isArray(j?.user?.profile?.children) ? j.user.profile.children : [];
      track("child_saved", { plan: tier, gender: gender || "neutral", edit: !!initial });
      onSaved(serverKids);
      onClose();
    } catch {
      setErr("Couldn't save the name right now — please try again.");
      setBusy(false);
    }
  }
  async function remove() {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ children: [] }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setErr(typeof j?.error === "string" ? j.error : "Couldn't remove the folder right now — please try again.");
        setBusy(false);
        return;
      }
      const kids: ChildInfo[] = Array.isArray(j?.user?.profile?.children) ? j.user.profile.children : [];
      track("child_removed", { plan: tier });
      onRemoved(kids);
      onClose();
    } catch {
      setErr("Couldn't remove the folder right now — please try again.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Name your child's folder">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
      />
      <div
        tabIndex={-1}
        className="bys-sheet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-[2rem] border-t-2 border-forest bg-card p-6 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:rounded-[2rem] sm:border-2"
      >
        <div className="bys-grabber" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">The folder</p>
          <button type="button" onClick={onClose} className="icon-btn min-h-11 text-stone" aria-label="Close">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <h3 className="mt-3 font-display text-2xl font-semibold leading-snug text-forest">Whose folder is this?</h3>
        <p className="mt-1 text-base text-stone">One name is all we need.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <label className="field-label mt-5" htmlFor="child-name">
            First name
          </label>
          <input
            id="child-name"
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErr("");
            }}
            maxLength={40}
            autoComplete="off"
            enterKeyHint="done"
            placeholder="e.g. Maya or Leo"
            className="min-h-12 w-full rounded-2xl border border-line bg-cream px-4 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
          />
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Sticker style (optional)">
            <button
              type="button"
              onClick={() => setGender(gender === "girl" ? undefined : "girl")}
              className={`chip ${gender === "girl" ? "border-forest bg-forest text-cream" : ""}`}
            >
              Girl
            </button>
            <button
              type="button"
              onClick={() => setGender(gender === "boy" ? undefined : "boy")}
              className={`chip ${gender === "boy" ? "border-forest bg-forest text-cream" : ""}`}
            >
              Boy
            </button>
          </div>
          <p className="mt-2 text-sm text-stone">Optional — we just pick the stickers.</p>
          <button type="submit" disabled={!name.trim() || busy} className="btn-primary mt-5 w-full text-lg">
            {busy ? "Decorating…" : "Make it theirs"}
          </button>
          {err && (
            <p role="alert" className="mt-3 text-base text-red-800">
              {err}
            </p>
          )}
          {initial ? (
            <div className="mt-6 border-t border-line pt-5">
              {confirmRemove ? (
                <div className="rounded-2xl bg-cream-deep/60 p-4">
                  <p className="text-base font-semibold text-forest">
                    Remove {initial.name}'s folder? The papers stay filed — just the name comes off.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={remove} disabled={busy} className="btn-ghost min-h-11 px-4 text-base text-red-900">
                      {busy ? "Removing…" : "Yes, remove"}
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy} className="min-h-11 text-base text-stone underline underline-offset-4">
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmRemove(true)} className="min-h-11 text-base text-stone underline underline-offset-4">
                  Remove this folder
                </button>
              )}
            </div>
          ) : null}
        </form>
      </div>
    </div>
  );
}
