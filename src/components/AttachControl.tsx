// Attachments (Steady+, owner 2026-08-11) — two-mode AI Co-Parent spec §3 + §4(a)(b).
//
// One shared control for both AI Co-Parent composers (landing ReviewTool + the
// dashboard ai tab):
//   - Steady+ (effective tier steady/command/ultimate — gift-month recipients
//     included, since the tier arrives as user.quota.tier): a real paperclip →
//     calm attach sheet. Files are NAME + NOTE ONLY — the client reads only
//     file.name (+ a type guard) and never reads file bytes, so the pixels
//     never leave the device and the no-OCR + privacy lines are trivially true.
//   - Free / signed-out: a QUIET Steady-marked ghost chip (visible but
//     non-functioning = the enticement moment, ratified) → the Steady
//     enticement sheet (one ask; the dad's draft stays in the box — a sheet,
//     never navigation).
// One-ask discipline: both sheets defer while another .bys-sheet is up.

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { track } from "~/lib/analytics";
import type { Attachment } from "~/lib/api";
import type { ToolMode } from "~/components/ModeSwitch";
import { IconAttach, IconClose } from "./icons";

const MAX_FILES = 4;
const MAX_NAME = 120;
const MAX_NOTE = 500;

function shortName(name: string) {
  return name.length > 40 ? name.slice(0, 37) + "…" : name;
}

// Shared sheet chrome (the bys-sheet pattern used across the app — SpecialOffer
// / CoParentCheckIn / Organizer): mobile bottom sheet with grabber + safe-area
// padding, right-anchored card on desktop. Focus management, Escape to close,
// scroll lock, focus restore on close.
function SheetFrame({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    lastFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey, true);
      lastFocus.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[36]" role="dialog" aria-modal="true" aria-label={label}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="bys-sheet absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-forest bg-card px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-3 shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:rounded-2xl sm:border"
      >
        <div className="bys-grabber" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

// ---- Paid attach sheet (spec §3) ----
function AttachSheet({
  mode,
  attachments,
  onCommit,
  onClose,
}: {
  mode: ToolMode;
  attachments: Attachment[];
  onCommit: (next: Attachment[]) => void;
  onClose: () => void;
}) {
  // Local editor state seeded from the committed list (the CTA commits; the
  // composer chips stay untouched until then). Component mounts only while open.
  const [files, setFiles] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setFiles(attachments.map((a) => ({ ...a })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(ev: ChangeEvent<HTMLInputElement>) {
    const list = ev.target.files;
    ev.target.value = ""; // allow re-picking the same file next time
    if (!list || list.length === 0) return;
    const incoming: Attachment[] = [];
    let reject: string | null = null;
    for (const f of Array.from(list)) {
      if (files.length + incoming.length >= MAX_FILES) {
        reject = "Up to 4 files per review.";
        break;
      }
      const name = f.name.trim();
      if (!name || name.length > MAX_NAME) {
        reject = `"${shortName(name || "this file")}" has a name that's too long — 120 characters max.`;
        break;
      }
      const isImage = f.type.startsWith("image/");
      const isPdf = name.toLowerCase().endsWith(".pdf");
      if (!isImage && !isPdf) {
        reject = `"${shortName(name)}" isn't a photo or PDF — we can only take those for now.`;
        break;
      }
      if (files.some((x) => x.name === name) || incoming.some((x) => x.name === name)) continue; // dedupe
      incoming.push({ name, description: "" });
    }
    if (reject) setError(reject);
    if (incoming.length > 0) {
      setFiles((prev) => [...prev, ...incoming]);
      track("attach_added", { mode, count: incoming.length });
      setError("");
    }
  }

  function removeFile(name: string) {
    setFiles((prev) => prev.filter((x) => x.name !== name));
    track("attach_removed", { mode });
  }

  function setDesc(name: string, desc: string) {
    setFiles((prev) => prev.map((x) => (x.name === name ? { ...x, description: desc } : x)));
  }

  function commit() {
    onCommit(files);
    onClose();
  }

  return (
    <SheetFrame onClose={onClose} label="Add a photo or document">
      <h2 className="mt-1 font-display text-2xl font-semibold leading-tight text-forest">Add a photo or document</h2>
      <p className="mt-2 text-base leading-relaxed text-stone">
        A message thread, an email, a school notice — anything that helps show what you're dealing with.
      </p>
      <p className="mt-3 rounded-2xl bg-cream-deep px-4 py-3 text-sm leading-relaxed text-stone">
        We can't read the image itself yet — one line about what it shows helps.
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="btn-ghost mt-4 w-full text-base"
      >
        Choose a photo or PDF
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        multiple
        className="hidden"
        onChange={pick}
        aria-hidden="true"
        tabIndex={-1}
      />
      {files.length > 0 && (
        <ul className="mt-4 space-y-3">
          {files.map((a) => (
            <li key={a.name} className="rounded-2xl border border-line bg-cream p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2 text-base font-medium text-ink">
                  <IconAttach className="h-5 w-5 shrink-0 text-forest-soft" />
                  <span className="truncate">{a.name}</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(a.name)}
                  aria-label={`Remove ${a.name}`}
                  className="icon-btn min-h-11 min-w-11 text-stone"
                >
                  <IconClose className="h-4 w-4" />
                </button>
              </div>
              <label htmlFor={`att-note-${a.name}`} className="sr-only">
                What should we know about {a.name}?
              </label>
              <input
                id={`att-note-${a.name}`}
                type="text"
                value={a.description}
                onChange={(e) => setDesc(a.name, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
                maxLength={MAX_NOTE}
                placeholder="e.g. the school's email about Friday's pickup"
                className="mt-2 w-full rounded-full border border-line bg-card px-4 py-2.5 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
              />
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm leading-relaxed text-stone">
        Only the file name and your note go to the AI. The file isn't stored — it's not added to your record.
      </p>
      <p className="mt-2 text-sm text-taupe">Up to 4 files per review.</p>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-base text-red-800">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={commit}
        disabled={files.length === 0}
        className="btn-primary mt-5 w-full text-lg"
      >
        {mode === "analyze" ? "Add to analysis" : "Add to review"}
      </button>
    </SheetFrame>
  );
}

// ---- Steady enticement sheet (spec §4 a/b): signed-out vs free-account copy ----
function SteadyEnticementSheet({
  mode,
  signedOut,
  onClose,
}: {
  mode: ToolMode;
  signedOut: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    track("steady_sheet_shown", { mode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cta = (
    <a
      href="/pricing"
      onClick={() => track("checkout_started", { plan: "steady", interval: "month" })}
      className="btn-primary mt-5 block w-full text-center text-lg"
    >
      Start Steady — $4.99/mo
    </a>
  );
  return (
    <SheetFrame onClose={onClose} label="Steady attachments">
      {signedOut ? (
        <>
          <h2 className="mt-1 font-display text-2xl font-semibold leading-tight text-forest">See what you're dealing with.</h2>
          <p className="mt-2 text-base leading-relaxed text-stone">
            Attach the photo, the email, the school notice — Steady brings your files into the review. We
            can't read the image itself yet; one line about what it shows goes a long way.
          </p>
          {cta}
          <p className="mt-3 text-center text-sm text-stone">Your files stay private. Cancel anytime.</p>
        </>
      ) : (
        <>
          <h2 className="mt-1 font-display text-2xl font-semibold leading-tight text-forest">Steady adds photos and documents.</h2>
          <p className="mt-2 text-base leading-relaxed text-stone">
            Message threads, emails, school notices — attach them and the review sees what you're dealing
            with. (One line about the file helps — we can't read the image itself yet.)
          </p>
          {cta}
          <p className="mt-3 text-center text-sm text-stone">
            Free stays text-only — that doesn't change. Your draft is still here.
          </p>
        </>
      )}
      <button type="button" onClick={onClose} className="mt-2 min-h-11 w-full text-base font-semibold text-forest">
        Not now
      </button>
    </SheetFrame>
  );
}

// ---- The composer control: paperclip (Steady+) or ghost chip (free) ----
export default function AttachControl({
  mode,
  canAttach,
  signedOut,
  attachments,
  onChange,
  disabled,
}: {
  mode: ToolMode;
  canAttach: boolean;      // effective tier steady/command/ultimate (user.quota.tier)
  signedOut: boolean;      // enticement copy variant (a) vs (b)
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
  disabled?: boolean;      // while streaming
}) {
  const [open, setOpen] = useState<"attach" | "steady" | null>(null);

  function openSheet(kind: "attach" | "steady") {
    // One ask at a time: never stack another sheet over one that's up.
    if (typeof document !== "undefined" && document.querySelector(".bys-sheet")) return;
    if (kind === "steady") track("attach_locked_tap", { mode });
    setOpen(kind);
  }

  if (canAttach) {
    return (
      <>
        <button
          type="button"
          onClick={() => openSheet("attach")}
          disabled={disabled}
          aria-label="Attach a photo or document"
          className="icon-btn min-h-11 disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <IconAttach className="h-6 w-6" />
        </button>
        {open === "attach" && (
          <AttachSheet
            mode={mode}
            attachments={attachments}
            onCommit={onChange}
            onClose={() => setOpen(null)}
          />
        )}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => openSheet("steady")}
        disabled={disabled}
        aria-label="Attach a photo or document with Steady"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-stone transition-colors duration-150 select-none hover:bg-cream-deep disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <IconAttach className="h-5 w-5 shrink-0 text-forest-soft" />
        <span>Steady</span>
      </button>
      {open === "steady" && (
        <SteadyEnticementSheet mode={mode} signedOut={signedOut} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

// The composer chips row — rendered BETWEEN the textarea and the footer row
// (spec §3): truncated filename + × remove. onRemove lives in the parent so it
// can update its own state; this component fires attach_removed.
export function AttachChips({
  mode,
  attachments,
  onRemove,
}: {
  mode: ToolMode;
  attachments: Attachment[];
  onRemove: (name: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2" aria-label="Attached files">
      {attachments.map((a) => (
        <span
          key={a.name}
          className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-cream-deep px-2.5 py-1 text-[13px] text-ink"
        >
          <IconAttach className="h-4 w-4 shrink-0 text-forest-soft" />
          <span className="min-w-0 truncate">{a.name}</span>
          <button
            type="button"
            onClick={() => {
              onRemove(a.name);
              track("attach_removed", { mode });
            }}
            aria-label={`Remove ${a.name}`}
            className="-mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-stone hover:bg-card hover:text-ink"
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
