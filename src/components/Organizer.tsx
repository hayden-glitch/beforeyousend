// "The Organizer" — full Document Organizer for Command Center / Ultimate
// tiers. The flagship paid feature: upload a photo/screenshot or paste text,
// we file it into the taxonomy (folder + subfolder + a short reason), browse
// by folder, move anything you disagree with, delete calmly. Public name is
// "The Organizer"; no "AI" anywhere in user copy. Copy is calm, father-first,
// one step at a time (owner philosophy: tiny ask → instant reward → casual
// next ask). Honesty rails: the classified folder is a suggestion, the dad
// decides; delete is one tap + confirm; no fake claims or urgency.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import { TAXONOMY, folderLabel, subfolderLabel } from "~/lib/taxonomy";
import {
  fileToDataUrl,
  fetchOrganizerFiles,
  createOrganizerFile,
  moveOrganizerFile,
  renameOrganizerFile,
  removeOrganizerFile,
  refileOrganizerFile,
  startCommandCheckout,
  type OrganizerFile,
} from "~/lib/organizer";
import RecordHealthPanel, { RecordHealthTeaser } from "./RecordHealth";
import { IconArrowLeft, IconCheck, IconChevronDown, IconClose, IconOrganizer, IconPlus } from "./icons";
import ChildFolder, { type ChildInfo } from "./ChildFolder";
import ChildCaptureSheet from "./ChildCaptureSheet";
import FolderOpenPanel from "./FolderOpenPanel";

type AddMode = "text" | "image";
type View = { name: "browse" } | { name: "folder"; folder: string } | { name: "add"; mode: AddMode };

const EMPTY_COPY =
  "Nothing here yet — add your first message, agreement, or receipt. We'll file it for you.";

function fmtDate(d: string): string {
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function snippet(f: OrganizerFile): string {
  if (f.kind === "text") return (f.content || "").trim();
  return f.summary || f.description || f.title || "Photo, screenshot, or PDF";
}

function isPdf(f: OrganizerFile): boolean {
  return f.kind === "image" && typeof f.dataUrl === "string" && f.dataUrl.startsWith("data:application/pdf");
}

function FileIcon({ f }: { f: OrganizerFile }) {
  if (f.kind === "image" && f.dataUrl && !isPdf(f)) {
    return (
      <img
        src={f.dataUrl}
        alt={f.description || f.title || "Document"}
        loading="lazy"
        className="h-11 w-11 shrink-0 rounded-[10px] border border-line object-cover"
      />
    );
  }
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-cream-deep/70 text-xs font-semibold text-forest">
      {f.kind === "image" ? (isPdf(f) ? "PDF" : "Photo") : "Text"}
    </span>
  );
}

/** Folder chips grid used by both the result panel and the move picker. */
function FolderPicker({
  current,
  selectedFolder,
  selectedSub,
  onFolder,
  onSub,
}: {
  current: { folder: string; category: string };
  selectedFolder: string;
  selectedSub: string;
  onFolder: (slug: string) => void;
  onSub: (slug: string) => void;
}) {
  const folder = TAXONOMY.find((f) => f.slug === selectedFolder) || TAXONOMY[0];
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Folders">
        {TAXONOMY.map((f) => (
          <button
            key={f.slug}
            type="button"
            onClick={() => onFolder(f.slug)}
            className={`chip whitespace-nowrap ${f.slug === selectedFolder ? "border-forest bg-forest text-cream" : ""}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${folder.label} subfolders`}>
        {folder.subfolders.map((s) => (
          <button
            key={s.slug}
            type="button"
            onClick={() => onSub(s.slug)}
            className={`chip whitespace-nowrap ${s.slug === selectedSub ? "border-forest bg-forest text-cream" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="sr-only">
        Currently {folderLabel(selectedFolder)} › {subfolderLabel(selectedFolder, selectedSub)}
      </p>
      {current.folder === selectedFolder && current.category === selectedSub ? null : (
        <p className="mt-2 text-sm leading-relaxed text-stone">
          Filing under {folderLabel(selectedFolder)} › {subfolderLabel(selectedFolder, selectedSub)}.
        </p>
      )}
    </div>
  );
}

export default function Organizer({
  tier,
  children,
  profile,
  onProfilePatch,
  onGoTo,
  onChildSave,
  lapsed,
  onRemoved,
  onLogGap,
  rhDismissed,
  onRhDismiss,
}: {
  tier: string;
  children: ChildInfo[];
  profile?: unknown;
  onProfilePatch?: (profile: unknown) => void;
  onGoTo?: (tab: string) => void;
  onChildSave: (children: ChildInfo[]) => void;
  lapsed?: boolean;
  onRemoved?: (children: ChildInfo[]) => void;
  onLogGap?: (gap: { fromLabel: string; toLabel: string; after: string; afterLabel: string }) => void;
  rhDismissed?: Record<string, boolean>;
  onRhDismiss?: (folder: string) => void;
}) {
  const [files, setFiles] = useState<OrganizerFile[] | null>(null); // null = loading
  const [loadErr, setLoadErr] = useState("");
  const [view, setView] = useState<View>({ name: "browse" });
  // Record Health (spec §1): recompute on every Organizer open (view → browse)
  // and after every write while mounted. The panel fetches on mount + key bump.
  const [healthKey, setHealthKey] = useState(0);
  useEffect(() => {
    if (view.name === "browse") setHealthKey((k) => k + 1);
  }, [view.name]);
  // Owner batch 2 (Design 1): ONE folder open at a time — keyed by the child's
  // stable id. Opening one closes the other; the ✕ / cover-tap closes it.
  const [openChildId, setOpenChildId] = useState<string | null>(null);
  const primary = children[0] ?? null;
  // Add form state (one tiny ask at a time).
  const [addMode, setAddMode] = useState<AddMode>("text");
  const [text, setText] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fileErr, setFileErr] = useState("");
  // The just-classified item, shown as the instant reward after upload.
  const [result, setResult] = useState<OrganizerFile | null>(null);
  // Move picker (on a result or an existing file card).
  const [moving, setMoving] = useState<OrganizerFile | null>(null);
  const [moveFolder, setMoveFolder] = useState("");
  const [moveSub, setMoveSub] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState("");
  // P2 drawer: document detail sheet — ONE action mode at a time (idle shows
  // the doc + the three actions; rename/move/delete each replace the actions
  // row). The file object is already in memory (files state) when the drawer
  // opens, so there is no loading state by design.
  const [openFile, setOpenFile] = useState<OrganizerFile | null>(null); // null = drawer closed
  const [drawerMode, setDrawerMode] = useState<"idle" | "rename" | "move" | "delete">("idle"); // ONE action at a time
  const [titleDraft, setTitleDraft] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [drawerErr, setDrawerErr] = useState("");
  // FRONT A — "needs a line from you" feedback: the notice card for the row
  // that came back other/needs-sorting, its one-line refile form, the calm
  // still-unsure dead-end escape, and the persistent slim strip that prevents
  // re-burial. `needsSorting` non-null = notice card open; `stillUnsure` =
  // the refile came back needs-sorting again (Pick the folder / I'll do it
  // later — never a loop, never a dead end).
  const [needsSorting, setNeedsSorting] = useState<OrganizerFile | null>(null);
  const [refileDraft, setRefileDraft] = useState("");
  const [refileBusy, setRefileBusy] = useState(false);
  const [refileErr, setRefileErr] = useState("");
  const [stillUnsure, setStillUnsure] = useState(false);
  const [stripDismissed, setStripDismissed] = useState(false);
  const needsSortingViewRef = useRef(false);
  const [flashFileId, setFlashFileId] = useState<string | null>(null);
  const [flashFolder, setFlashFolder] = useState<string | null>(null);
  // FRONT B — child-folder capture sheet (B7): `initial` null = fresh capture,
  // non-null = edit (✎ reopens pre-filled).
  const [capture, setCapture] = useState<{ open: boolean; initial: ChildInfo | null }>({
    open: false,
    initial: null,
  });

  const load = useCallback(async () => {
    const r = await fetchOrganizerFiles();
    if (r.ok) {
      setFiles(r.value);
      setLoadErr("");
    } else {
      setLoadErr(r.error);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of files || []) m[f.folder] = (m[f.folder] || 0) + 1;
    return m;
  }, [files]);

  const isNeedsSortingRow = (f: OrganizerFile) => f.folder === "other" && f.category === "needs-sorting";
  // Oldest first — "File it now" always reopens the notice for the oldest row.
  const needsSortingRows = useMemo(
    () =>
      (files || [])
        .filter(isNeedsSortingRow)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))),
    [files]
  );
  // A6: track organizer_needs_sorting_view ONCE per mount when rows exist.
  useEffect(() => {
    if (files && needsSortingRows.length > 0 && !needsSortingViewRef.current) {
      needsSortingViewRef.current = true;
      track("organizer_needs_sorting_view", { plan: tier });
    }
  }, [files, needsSortingRows.length, tier]);
  // A5: the amber ring flash announces where the refiled row went — clear it
  // after the 1.6s animation so it can fire again on the next refile.
  useEffect(() => {
    if (!flashFileId && !flashFolder) return;
    const t = setTimeout(() => {
      setFlashFileId(null);
      setFlashFolder(null);
    }, 1800);
    return () => clearTimeout(t);
  }, [flashFileId, flashFolder]);

  function resetAdd() {
    setText("");
    setDataUrl("");
    setFileName("");
    setDescription("");
    setErr("");
    setFileErr("");
  }

  function openAdd(mode: AddMode) {
    resetAdd();
    setAddMode(mode);
    setResult(null);
    setView({ name: "add", mode });
  }

  // Record Health actions (spec §1 finding cards): the gap card's quiet link
  // opens image mode with the description pre-filled "Paper from {Mar 15–22}:";
  // the missing-doc "Add the paper" opens image mode with the description
  // field pre-focused (image mode, description pre-focused per spec).
  function openGapPaper(gap: { fromLabel: string; toLabel: string }) {
    resetAdd();
    setAddMode("image");
    setDescription(`Paper from ${gap.fromLabel}–${gap.toLabel}:`);
    setResult(null);
    setView({ name: "add", mode: "image" });
  }
  function openAddImageFocused() {
    resetAdd();
    setAddMode("image");
    setResult(null);
    setView({ name: "add", mode: "image" });
    requestAnimationFrame(() => document.getElementById("org-add-desc")?.focus());
  }

  async function onFile(f: File | undefined) {
    setFileErr("");
    if (!f) return;
    try {
      const url = await fileToDataUrl(f);
      setDataUrl(url);
      setFileName(f.name);
    } catch (e) {
      setFileErr(e instanceof Error ? e.message : "Couldn't process that image — please try again.");
    }
  }

  async function submit() {
    if (busy) return;
    setErr("");
    if (addMode === "text") {
      if (!text.trim()) {
        setErr("Paste or type something to file first.");
        return;
      }
    } else if (!dataUrl) {
      setErr("Choose a screenshot or bill first.");
      return;
    }
    setBusy(true);
    const res = await createOrganizerFile({
      kind: addMode,
      text: addMode === "text" ? text.trim() : undefined,
      title: addMode === "image" && fileName ? fileName : undefined,
      dataUrl: addMode === "image" ? dataUrl : undefined,
      description: addMode === "image" ? description.trim() : undefined,
    });
    setBusy(false);
    if (res.ok) {
      track("organizer_upload", { plan: tier, kind: addMode, folder: res.value.folder });
      // A1: an unclassifiable upload must NOT look like a success — suppress
      // the "Filed under …" result panel and let the notice card take its place.
      const unclear = isNeedsSortingRow(res.value);
      if (unclear) {
        track("organizer_needs_sorting", { plan: tier, kind: addMode });
        setResult(null);
        setNeedsSorting(res.value);
        setStillUnsure(false);
        setRefileDraft("");
        setRefileErr("");
        setStripDismissed(false);
      } else {
        setResult(res.value);
      }
      setFiles((prev) => (prev ? [res.value, ...prev] : prev));
      setView({ name: "browse" });
      setHealthKey((k) => k + 1); // Record Health recomputes after an upload
    } else {
      setErr(res.error);
    }
  }

  function startMove(f: OrganizerFile) {
    setMoving(f);
    setMoveFolder(f.folder);
    setMoveSub(f.category);
    setNotice("");
  }

  // A3/A5: one-line refile — re-classify with the dad's description. If it
  // comes back needs-sorting AGAIN, go calm-still-unsure (never a loop); the
  // description is saved either way, so the row is no longer a mystery.
  async function doRefile() {
    if (!needsSorting || refileBusy) return;
    const d = refileDraft.trim();
    if (!d) {
      setRefileErr("One line is all it takes — even a few words.");
      return;
    }
    setRefileBusy(true);
    setRefileErr("");
    const res = await refileOrganizerFile(needsSorting.id, d);
    setRefileBusy(false);
    if (res.ok) {
      const f = res.value;
      setFiles((prev) => (prev ? prev.map((x) => (x.id === f.id ? f : x)) : prev));
      if (isNeedsSortingRow(f)) {
        setStillUnsure(true);
      } else {
        setNeedsSorting(null);
        setStillUnsure(false);
        setRefileDraft("");
        setFlashFileId(f.id);
        setFlashFolder(f.folder);
        setNotice(`Filed under ${folderLabel(f.folder)} › ${subfolderLabel(f.folder, f.category)}.`);
        setHealthKey((k) => k + 1); // Record Health recomputes after a refile
      }
    } else {
      track("organizer_refile_failed", { plan: tier });
      setRefileErr(res.error);
    }
  }

  function dismissNeedsSorting() {
    setNeedsSorting(null);
    setStillUnsure(false);
    setRefileErr("");
    track("organizer_needs_sorting_dismissed", { plan: tier });
  }

  async function doMove() {
    if (!moving || moveBusy) return;
    if (moveFolder === moving.folder && moveSub === moving.category) {
      setMoving(null);
      setDrawerMode("idle");
      return;
    }
    setMoveBusy(true);
    const res = await moveOrganizerFile(moving.id, moveFolder, moveSub);
    setMoveBusy(false);
    if (res.ok) {
      track("organizer_move", { plan: tier });
      setFiles((prev) => (prev ? prev.map((x) => (x.id === res.value.id ? res.value : x)) : prev));
      setNotice(`Moved to ${folderLabel(moveFolder)} › ${subfolderLabel(moveFolder, moveSub)}.`);
      setMoving(null);
      setHealthKey((k) => k + 1); // Record Health recomputes after a move
      if (openFile && openFile.id === res.value.id) setOpenFile(res.value);
      setDrawerMode("idle");
      if (result && result.id === moving.id) setResult(res.value);
      // Moved the row the notice card was asking about → the notice closes.
      if (needsSorting && needsSorting.id === moving.id) {
        setNeedsSorting(null);
        setStillUnsure(false);
        setRefileDraft("");
      }
    } else {
      if (openFile) setDrawerErr(res.error); else setNotice(res.error);
    }
  }

  async function doDelete(f: OrganizerFile) {
    if (deleting) return;
    setDeleting(true);
    const res = await removeOrganizerFile(f.id);
    setDeleting(false);
    if (res.ok) {
      track("organizer_delete", { plan: tier, folder: f.folder });
      setFiles((prev) => (prev ? prev.filter((x) => x.id !== f.id) : prev));
      if (result && result.id === f.id) setResult(null);
      if (openFile && openFile.id === f.id) setOpenFile(null);
      if (needsSorting && needsSorting.id === f.id) {
        setNeedsSorting(null);
        setStillUnsure(false);
        setRefileDraft("");
      }
      setNotice("Removed.");
      setHealthKey((k) => k + 1); // Record Health recomputes after a delete
    } else {
      if (openFile) setDrawerErr(res.error); else setNotice(res.error);
    }
  }
  // P2 drawer helpers: opening resets to the idle view (one action at a time);
  // closing always collapses back to idle so the next open starts clean.
  function openDrawer(f: OrganizerFile) {
    setOpenFile(f);
    setDrawerMode("idle");
    setDrawerErr("");
    setMoving(null);
    setNotice("");
    track("organizer_drawer_open", { plan: tier, kind: f.kind });
  }
  function closeDrawer() {
    setOpenFile(null);
    setDrawerMode("idle");
    setDrawerErr("");
    setMoving(null);
  }
  async function doRename() {
    if (!openFile || renameBusy) return;
    const t = titleDraft.trim();
    if (!t) return;
    setRenameBusy(true);
    setDrawerErr("");
    const res = await renameOrganizerFile(openFile.id, t);
    setRenameBusy(false);
    if (res.ok) {
      track("organizer_rename", { plan: tier });
      setFiles((prev) => (prev ? prev.map((x) => (x.id === res.value.id ? res.value : x)) : prev));
      setOpenFile(res.value);
      setDrawerMode("idle");
      setHealthKey((k) => k + 1); // Record Health recomputes after a rename
    } else {
      setDrawerErr(res.error);
    }
  }

  const shownFiles = useMemo(() => {
    if (!files) return [];
    if (view.name !== "folder") return files;
    return files.filter((f) => f.folder === view.folder);
  }, [files, view]);

  return (
    <section className="mt-5">
      <div className="flex items-center gap-2">
        <IconOrganizer className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">The Organizer</p>
      </div>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-forest">
        {primary
          ? children.length === 1
            ? `${primary.name}'s papers, in one calm place.`
            : "Your kids' papers, in one calm place."
          : "Your documents, in one calm place."}
      </h2>
      <p className="mt-2 max-w-xl text-base leading-relaxed text-stone">
        Messages, screenshots, bills, records — filed the moment you drop them in.
      </p>

      {loadErr ? (
        <div className="mt-6 rounded-[14px] border border-line bg-cream-deep/60 p-6">
          <p className="text-base leading-relaxed text-ink">{loadErr}</p>
          <button onClick={load} className="btn-primary mt-4 w-full sm:w-auto">Try again</button>
        </div>
      ) : files === null ? (
        <p className="mt-6 text-base text-stone">Loading your documents…</p>
      ) : (
        <>
          {/* ===== BROWSE ===== */}
          {view.name === "browse" ? (
            <>
              {/* ===== FRONT A: the notice card (first in the body, above
                  everything — an unclassifiable upload must be unmissable) ===== */}
              {needsSorting ? (
                <div className="mt-4 rounded-[14px] border border-amber-500/40 bg-amber-50 p-5 sm:max-w-2xl">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <IconOrganizer className="mt-0.5 h-5 w-5 shrink-0 text-amber-900" aria-hidden="true" />
                      <div>
                        {stillUnsure ? (
                          <>
                            <h3 className="text-lg font-semibold text-ink">Still not sure — that's okay.</h3>
                            <p className="mt-1 text-base leading-relaxed text-stone">
                              We can't read the picture itself, so a guess is all we get. Want to pick the folder by hand?
                            </p>
                          </>
                        ) : (
                          <>
                            <h3 className="text-lg font-semibold text-ink">This one needs a line from you.</h3>
                            <p className="mt-1 text-base leading-relaxed text-stone">
                              We filed it under "Needs sorting" until we know what it is. One line is all it takes — then it goes where it belongs.
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    <button type="button" onClick={dismissNeedsSorting} className="icon-btn min-h-11 text-amber-900" aria-label="Dismiss">
                      <IconClose className="h-5 w-5" />
                    </button>
                  </div>
                  {!stillUnsure ? (
                    <>
                      <form
                        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center"
                        onSubmit={(e) => {
                          e.preventDefault();
                          doRefile();
                        }}
                      >
                        <label className="sr-only" htmlFor="org-refile-line">What is this?</label>
                        <input
                          id="org-refile-line"
                          type="text"
                          value={refileDraft}
                          onChange={(e) => {
                            setRefileDraft(e.target.value);
                            setRefileErr("");
                          }}
                          maxLength={500}
                          placeholder="What is this? e.g. Daycare bill for February — receipt from the center"
                          className="input min-h-12 w-full flex-1"
                        />
                        <button type="submit" disabled={!refileDraft.trim() || refileBusy} className="btn-primary shrink-0">
                          {refileBusy ? "Filing it…" : "File it"}
                        </button>
                      </form>
                      {refileBusy && (
                        <p className="mt-3 flex items-center gap-2 text-sm text-stone" role="status">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" aria-hidden="true" />
                          Working on it…
                        </p>
                      )}
                      {refileErr && <p role="alert" className="mt-3 text-base text-red-800">{refileErr}</p>}
                      {/* Honest no-OCR why-line — always visible, verbatim. */}
                      <p className="mt-4 text-sm leading-relaxed text-stone">
                        We can't see inside the image yet — a line of text tells us where it goes.
                      </p>
                    </>
                  ) : (
                    <>
                      {moving && moving.id === needsSorting.id ? (
                        <div className="mt-4 rounded-[14px] border border-line bg-card p-4">
                          <p className="text-base font-semibold text-forest">Move it somewhere else?</p>
                          <div className="mt-3">
                            <FolderPicker
                              current={{ folder: needsSorting.folder, category: needsSorting.category }}
                              selectedFolder={moveFolder}
                              selectedSub={moveSub}
                              onFolder={(s) => { setMoveFolder(s); setMoveSub(TAXONOMY.find((f) => f.slug === s)?.subfolders[0]?.slug || "needs-sorting"); }}
                              onSub={setMoveSub}
                            />
                          </div>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button onClick={doMove} disabled={moveBusy} className="btn-primary min-h-11 px-5 text-base">
                              {moveBusy ? "Moving…" : "Move here"}
                            </button>
                            <button onClick={() => setMoving(null)} className="btn-ghost min-h-11 px-5 text-base text-forest">Keep it here</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              track("organizer_refile_pick_folder", { plan: tier });
                              startMove(needsSorting);
                            }}
                            className="btn-primary min-h-11 px-5 text-base"
                          >
                            Pick the folder
                          </button>
                          <button onClick={dismissNeedsSorting} className="btn-ghost min-h-11 px-5 text-base text-forest">
                            I'll do it later
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {/* ===== FRONT B: the children's folders (scene(s) at the top of
                  the browse view, below the section label, above the heading).
                  Each folder OPENS AND STAYS: tap → cover rotates away (600ms),
                  the Ratings + To-Do papers render below the scene in flow, and
                  the fixed open-folder bar pins at top: 5rem until the dad
                  closes it (✕ or cover-tap). No scroll-away, no park, no sheet. ===== */}
              <div className="mt-5 space-y-3">
                {children.length === 0 ? (
                  <ChildFolder
                    child={null}
                    open={false}
                    onToggleOpen={() => {}}
                    paperCount={files.length}
                    onOpenCapture={() => {
                      track("child_capture_started", { plan: tier });
                      setCapture({ open: true, initial: null });
                    }}
                    onEdit={() => {}}
                  />
                ) : (
                  <>
                    {children.map((c) => {
                      const cid = c.id || c.name;
                      const isOpen = openChildId === cid;
                      return (
                        <div key={cid}>
                          <ChildFolder
                            child={c}
                            open={isOpen}
                            onToggleOpen={() => setOpenChildId(isOpen ? null : cid)}
                            paperCount={files.length}
                            onOpenCapture={() => {
                              track("child_capture_started", { plan: tier });
                              setCapture({ open: true, initial: null });
                            }}
                            onEdit={() => setCapture({ open: true, initial: c })}
                          />
                          {isOpen && (
                            <FolderOpenPanel
                              child={c}
                              tier={tier}
                              profile={profile}
                              onProfilePatch={(p) => onProfilePatch?.(p)}
                              onGoLog={() => onGoTo?.("log")}
                              onGoAction={() => onGoTo?.("action")}
                            />
                          )}
                        </div>
                      );
                    })}
                    {/* Add-sibling: once a child exists, a quiet second-folder
                        affordance (the capture sheet opens in ADD mode). The
                        server merge appends an unknown name — siblings safe. */}
                    {children.length < 4 && (
                      <button
                        type="button"
                        onClick={() => {
                          track("child_capture_started", { plan: tier });
                          setCapture({ open: true, initial: null });
                        }}
                        className="min-h-11 rounded-[10px] border border-line bg-card px-5 text-base font-semibold text-forest transition hover:border-forest/40"
                      >
                        + Add another child
                      </button>
                    )}
                  </>
                )}
              </div>

              {/* ===== RECORD HEALTH (organizer-expansion spec §1) — top of the
                  browse view, below the child-folder scene, above the Add
                  buttons + folders grid. Command/Ultimate get the live panel;
                  everyone else (incl. lapsed Sort My Pile) gets the calm teaser. */}
              <div className="mt-5">
                {tier === "command" || tier === "ultimate" ? (
                  <RecordHealthPanel
                    tier={tier}
                    refreshKey={healthKey}
                    onLogGap={onLogGap}
                    onAddPaper={openAddImageFocused}
                    onAddGapPaper={openGapPaper}
                    dismissed={rhDismissed}
                    onDismiss={onRhDismiss}
                  />
                ) : (
                  <RecordHealthTeaser onGoCommand={startCommandCheckout} />
                )}
              </div>

              {lapsed ? (
                <div className="mt-5 rounded-[14px] border border-forest/20 bg-cream-deep/60 p-5">
                  <p className="text-base leading-relaxed text-ink">
                    Your Sort My Pile access has ended - your papers are still here. You can keep viewing, renaming, and deleting them.
                  </p>
                  <a href="/pricing" className="mt-3 inline-flex min-h-11 items-center text-base font-semibold text-forest underline underline-offset-4">
                    See Command Center →
                  </a>
                </div>
              ) : null}
              {lapsed ? (
                <div className="mt-5">
                  <a href="/pricing" className="btn-primary min-h-14 w-full text-center sm:w-auto sm:inline-flex sm:items-center">
                    See Command Center →
                  </a>
                </div>
              ) : (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button onClick={() => openAdd("image")} className="btn-primary min-h-14">
                  <IconPlus className="h-5 w-5" />Add a photo, screenshot, or PDF
                </button>
                <button onClick={() => openAdd("text")} className="btn-ghost min-h-14 text-forest">
                  Paste or type text
                </button>
              </div>
              )}

              {/* ===== Documents — the working list (§7): type, category, date,
                  filing suggestion — one recessed ledger surface ===== */}
              <div className="mt-6 overflow-hidden rounded-[14px] border border-line bg-cream-deep/60">
                <div className="flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3">
                  <h3 className="font-display text-lg font-semibold text-forest">Documents</h3>
                  <span className="text-sm text-taupe tabular-nums">{files.length} file{files.length === 1 ? "" : "s"}</span>
                </div>
                {files.length === 0 ? (
                  <p className="px-4 py-5 text-base leading-relaxed text-ink">
                    {primary
                      ? `Nothing's saved for ${primary.name} yet. Every paper starts here — add your first message, agreement, or receipt and it'll be filed where you can find it.`
                      : EMPTY_COPY}
                  </p>
                ) : (
                  <div className="divide-y divide-line/60">
                    {/* A6: persistent slim strip — needs-sorting rows exist and the
                        notice is closed. Quiet, not a card, no amber bomb. */}
                    {!needsSorting && needsSortingRows.length > 0 && !stripDismissed ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                        <p className="min-w-0 flex-1 text-base text-amber-900">
                          {needsSortingRows.length === 1
                            ? "1 paper is waiting for a line from you — file it in 30 seconds."
                            : `${needsSortingRows.length} papers are waiting for a line from you — file them in 30 seconds.`}
                        </p>
                        <button
                          onClick={() => {
                            setNeedsSorting(needsSortingRows[0]);
                            setStillUnsure(false);
                            setRefileDraft("");
                            setRefileErr("");
                            setStripDismissed(false);
                          }}
                          className="min-h-11 text-base font-semibold text-amber-900 underline underline-offset-4"
                        >
                          File it now
                        </button>
                        <button
                          onClick={() => {
                            setStripDismissed(true);
                            track("organizer_needs_sorting_dismissed", { plan: tier });
                          }}
                          className="icon-btn min-h-11 text-amber-900"
                          aria-label="Dismiss"
                        >
                          <IconClose className="h-5 w-5" />
                        </button>
                      </div>
                    ) : null}
                    {files.map((f) => (
                      <FileRow key={f.id} f={f} onOpen={() => openDrawer(f)} flash={flashFileId === f.id} />
                    ))}
                  </div>
                )}
              </div>

              {/* ===== Browse by folder — quiet navigation rows ===== */}
              <h3 className="mt-6 font-display text-lg font-semibold text-forest">Browse by folder</h3>
              <div className="mt-3 space-y-2">
                {TAXONOMY.map((f) => {
                  const amber = f.slug === "other" && needsSortingRows.length > 0;
                  const flash = flashFolder === f.slug;
                  return (
                    <button
                      key={f.slug}
                      onClick={() => { track("organizer_folder_view", { plan: tier, folder: f.slug }); setView({ name: "folder", folder: f.slug }); }}
                      className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[14px] border border-line bg-card px-4 py-3 text-left shadow-card transition hover:border-forest/30 ${flash ? "bys-needs-sorting-flash" : ""}`}
                    >
                      <span className="min-w-0 text-base font-semibold text-forest">{f.label}</span>
                      <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-medium ${amber ? "border-amber-500/50 bg-amber-50 text-amber-900" : "border-line bg-cream-deep text-stone"}`}>
                        {counts[f.slug] || 0}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-wrap justify-end gap-1.5">
                        {f.subfolders.map((s) => (
                          <span key={s.slug} className="rounded-md border border-line bg-cream-deep px-2 py-0.5 text-xs font-medium text-stone">{s.label}</span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* ===== FOLDER VIEW ===== */}
          {view.name === "folder" ? (
            <>
              <button onClick={() => setView({ name: "browse" })} className="mt-4 inline-flex min-h-11 items-center gap-1 text-base font-semibold text-forest underline underline-offset-4">
                <IconArrowLeft className="h-4 w-4" />All folders
              </button>
              <h2 className="mt-2 font-display text-3xl font-semibold text-forest">{folderLabel(view.folder)}</h2>
              <p className="mt-1 text-base text-stone">
                This folder: {shownFiles.length} paper{shownFiles.length === 1 ? "" : "s"} · last added{" "}
                {shownFiles.length
                  ? fmtDate(shownFiles.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0].createdAt)
                  : "—"}
              </p>
              <p className="mt-1 text-sm text-stone">
                {TAXONOMY.find((f) => f.slug === view.folder)?.subfolders.map((s) => s.label).join(" · ")}
              </p>
              {shownFiles.length === 0 ? (
                <div className="mt-5 rounded-[14px] border border-line bg-cream-deep/60 p-5">
                  <p className="text-base leading-relaxed text-ink">Nothing in this folder yet.</p>
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[14px] border border-line bg-cream-deep/60">
                  <div className="divide-y divide-line/60">
                    {shownFiles.map((f) => (
                      <FileRow key={f.id} f={f} onOpen={() => openDrawer(f)} flash={flashFileId === f.id} />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* ===== ADD ===== */}
          {view.name === "add" ? (
            <>
              <button onClick={() => setView({ name: "browse" })} className="mt-4 inline-flex min-h-11 items-center gap-1 text-base font-semibold text-forest underline underline-offset-4">
                <IconArrowLeft className="h-4 w-4" />Back to folders
              </button>
              <h2 className="mt-2 font-display text-3xl font-semibold text-forest">
                {addMode === "text" ? "Add a message or note" : "Add a photo, screenshot, or PDF"}
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setAddMode("text"); resetAdd(); }} className={`chip ${addMode === "text" ? "border-forest bg-forest text-cream" : ""}`}>
                  Paste or type text
                </button>
                <button type="button" onClick={() => { setAddMode("image"); resetAdd(); }} className={`chip ${addMode === "image" ? "border-forest bg-forest text-cream" : ""}`}>
                  Add a photo, screenshot, or PDF →
                </button>
              </div>

              {addMode === "text" ? (
                <>
                  <label className="field-label mt-5" htmlFor="org-add-text">What do you want to keep?</label>
                  <textarea
                    id="org-add-text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={6}
                    maxLength={10000}
                    placeholder="A message from your co-parent, an agreement excerpt, a note to remember…"
                    className="mt-2 min-h-40 w-full resize-y rounded-[14px] border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
                  />
                  <p className="mt-2 text-sm text-stone">{text.length}/10000</p>
                </>
              ) : (
                <div className="mt-5">
                  <label className="btn-ghost min-h-11 cursor-pointer gap-1.5 text-base">
                    {fileName ? <><IconCheck className="h-4 w-4" />{fileName.length > 40 ? fileName.slice(0, 37) + "…" : fileName}</> : <>Choose a photo, screenshot, or PDF →</>}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
                      className="sr-only"
                      onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                  {fileErr && <p role="alert" className="mt-3 text-base text-red-800">{fileErr}</p>}
                  {dataUrl && !dataUrl.startsWith("data:application/pdf") && <img src={dataUrl} alt="Your upload" className="mt-4 max-h-64 rounded-2xl border border-line object-contain" />}
                  {dataUrl && dataUrl.startsWith("data:application/pdf") && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-[14px] border border-line bg-cream-deep px-4 py-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-card text-sm font-bold text-forest">PDF</span>
                      <span className="min-w-0 text-base font-semibold text-forest">{fileName || "Document ready"}</span>
                    </div>
                  )}
                  <label className="field-label mt-5" htmlFor="org-add-desc">What is this? <span className="font-normal text-stone">(optional — a line helps us file it right)</span></label>
                  <textarea
                    id="org-add-desc"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    maxLength={500}
                    placeholder="e.g. Daycare bill for February — receipt from the center"
                    className="mt-2 w-full resize-y rounded-[14px] border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
                  />
                  <p className="mt-2 text-sm leading-relaxed text-stone">Your files stay private to you — photos you add through the app are re-saved with location and other details stripped.</p>
                </div>
              )}

              <button onClick={submit} disabled={busy || (addMode === "text" ? !text.trim() : !dataUrl)} className="btn-primary mt-5 w-full text-lg">
                {busy ? "Filing it…" : "File it for me"}
              </button>
              {busy && (
                <p className="mt-3 flex items-center justify-center gap-2 text-sm text-stone" role="status">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-forest-soft border-t-transparent" aria-hidden="true" />
                  Working on it…
                </p>
              )}
              {err && <p role="alert" className="mt-4 text-base text-red-800">{err}</p>}
            </>
          ) : null}

          {/* ===== CLASSIFIED RESULT (the instant reward) ===== */}
          {result && view.name === "browse" ? (
            <div aria-live="polite" className="mt-6 rounded-[14px] border border-forest/20 bg-cream-deep/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-2xl font-semibold leading-snug text-forest">
                  Filed under {folderLabel(result.folder)} › {subfolderLabel(result.folder, result.category)}
                </h3>
                <button type="button" onClick={() => setResult(null)} className="icon-btn min-h-11 text-forest" aria-label="Dismiss">
                  <IconClose className="h-5 w-5" />
                </button>
              </div>
              {result.summary && <p className="mt-2 text-base leading-relaxed text-ink">{result.summary}</p>}
              <p className="mt-2 text-base leading-relaxed text-ink">
                {result.reason ? `Why: ${result.reason}` : `Filed under ${folderLabel(result.folder)}.`}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip border-forest bg-forest text-cream">{folderLabel(result.folder)}</span>
                <span className="chip border-line bg-card">{subfolderLabel(result.folder, result.category)}</span>
              </div>
              {result.tags && result.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {result.tags.slice(0, 5).map((t) => (
                    <span key={t} className="rounded-md border border-forest/25 bg-card px-3 py-1 text-sm font-medium text-forest">{t}</span>
                  ))}
                </div>
              )}
              <p className="mt-4 border-t border-line/70 pt-4 text-sm leading-relaxed text-stone">That's our best guess — you're the one who decides where it lives.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {moving && moving.id === result.id ? (
                  <div className="w-full rounded-[14px] border border-line bg-card p-4">
                    <p className="text-base font-semibold text-forest">Move it somewhere else?</p>
                    <div className="mt-3">
                      <FolderPicker
                        current={{ folder: result.folder, category: result.category }}
                        selectedFolder={moveFolder}
                        selectedSub={moveSub}
                        onFolder={(s) => { setMoveFolder(s); setMoveSub(TAXONOMY.find((f) => f.slug === s)?.subfolders[0]?.slug || "needs-sorting"); }}
                        onSub={setMoveSub}
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={doMove} disabled={moveBusy} className="btn-primary min-h-11 px-5 text-base">
                        {moveBusy ? "Moving…" : "Move here"}
                      </button>
                      <button onClick={() => setMoving(null)} className="btn-ghost min-h-11 px-5 text-base text-forest">Keep it here</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => startMove(result)} className="btn-ghost min-h-11 px-5 text-base text-forest">Move it to a different folder</button>
                )}
                <button onClick={() => { setResult(null); }} className="btn-primary min-h-11 px-5 text-base">Done</button>
              </div>
            </div>
          ) : null}



          {notice && (
            <p className="mt-5 rounded-[14px] bg-cream-deep px-4 py-3 text-base text-stone" role="status">{notice}</p>
          )}
        </>
      )}
      {/* ===== P2 DOCUMENT DRAWER (detail sheet — summary, tags, folder,
          reason, ONE action at a time: rename / move / delete) ===== */}
      {openFile && (
        <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Document details">
          <button
            type="button"
            aria-label="Close"
            onClick={closeDrawer}
            className="absolute inset-0 h-full w-full cursor-default bg-forest/25"
          />
          <div
            tabIndex={-1}
            className="bys-sheet absolute inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-[14px] border-t-2 border-forest bg-elevated p-6 pb-[max(24px,env(safe-area-inset-bottom))] shadow-2xl outline-none sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[26rem] sm:rounded-[14px] sm:border-2"
          >
            <div className="bys-grabber" aria-hidden="true" />
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Document</p>
              <button type="button" onClick={closeDrawer} className="icon-btn min-h-11 text-stone" aria-label="Close"><IconClose className="h-5 w-5" /></button>
            </div>
            <h3 className="mt-3 font-display text-2xl font-semibold leading-snug text-forest">
              {openFile.title || (openFile.kind === "text" ? "Pasted text" : "Photo, screenshot, or PDF")}
            </h3>
            <p className="mt-1 text-base text-stone">Added {fmtDate(openFile.createdAt)}</p>
            <p className="mt-3 text-base text-forest">
              Filed under {folderLabel(openFile.folder)} › {subfolderLabel(openFile.folder, openFile.category)}
            </p>
            {openFile.reason ? (
              <p className="mt-2 text-sm text-stone">That's our best guess — you're the one who decides where it lives.</p>
            ) : null}
            {openFile.summary ? (
              <p className="mt-4 text-base leading-relaxed text-ink">{openFile.summary}</p>
            ) : null}
            {openFile.tags && openFile.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {openFile.tags.map((t) => (
                  <span key={t} className="rounded-md border border-line bg-cream-deep px-2.5 py-0.5 text-xs font-medium text-stone break-words">{t}</span>
                ))}
              </div>
            ) : null}
            {openFile.kind === "text" ? (
              <p className="mt-4 whitespace-pre-wrap rounded-[14px] bg-cream-deep/60 p-4 text-sm leading-relaxed text-ink">{openFile.content}</p>
            ) : (
              <p className="mt-4 rounded-[14px] bg-cream-deep/60 p-4 text-sm leading-relaxed text-ink">{snippet(openFile)}</p>
            )}
            {drawerMode === "idle" && (
              <div className="mt-6 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setDrawerMode("rename"); setTitleDraft(openFile.title || ""); setDrawerErr(""); }} className="btn-ghost min-h-11 px-4 text-base text-forest">Rename</button>
                <button type="button" onClick={() => { startMove(openFile); setDrawerMode("move"); setDrawerErr(""); }} className="btn-ghost min-h-11 px-4 text-base text-forest">Move</button>
                <button type="button" onClick={() => { setDrawerMode("delete"); setDrawerErr(""); }} className="btn-ghost min-h-11 px-4 text-base text-red-900">Delete</button>
              </div>
            )}
            {drawerMode === "rename" && (
              <div className="mt-6">
                <label className="field-label" htmlFor="drawer-rename">Name this item</label>
                <input
                  id="drawer-rename"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  maxLength={200}
                  placeholder="A short name to find it by…"
                  className="input min-h-12 w-full rounded-xl px-4"
                  autoFocus
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={doRename} disabled={!titleDraft.trim() || renameBusy} className="btn-primary min-h-11 px-5 text-base">
                    {renameBusy ? "Saving…" : "Save name"}
                  </button>
                  <button type="button" onClick={() => setDrawerMode("idle")} className="btn-ghost min-h-11 px-5 text-base text-forest">Cancel</button>
                </div>
              </div>
            )}
            {drawerMode === "move" && moving && (
              <div className="mt-6">
                <p className="text-base font-semibold text-forest">Move it somewhere else?</p>
                <div className="mt-3">
                  <FolderPicker
                    current={{ folder: moving.folder, category: moving.category }}
                    selectedFolder={moveFolder}
                    selectedSub={moveSub}
                    onFolder={(s) => { setMoveFolder(s); setMoveSub(TAXONOMY.find((x) => x.slug === s)?.subfolders[0]?.slug || "needs-sorting"); }}
                    onSub={setMoveSub}
                  />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={doMove} disabled={moveBusy} className="btn-primary min-h-11 px-5 text-base">
                    {moveBusy ? "Moving…" : "Move here"}
                  </button>
                  <button onClick={() => setDrawerMode("idle")} className="btn-ghost min-h-11 px-5 text-base text-forest">Keep it here</button>
                </div>
              </div>
            )}
            {drawerMode === "delete" && (
              <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[14px] border border-red-900/30 bg-red-50 px-4 py-2">
                <span className="text-base text-red-900">Remove this item?</span>
                <button onClick={() => doDelete(openFile)} disabled={deleting} className="min-h-11 text-base font-semibold text-red-900 underline underline-offset-4">
                  {deleting ? "Removing…" : "Yes, remove"}
                </button>
                <button onClick={() => setDrawerMode("idle")} className="min-h-11 text-base text-stone underline underline-offset-4">Keep it</button>
              </div>
            )}
            {drawerErr && <p role="alert" className="mt-4 text-base text-red-800">{drawerErr}</p>}
          </div>
        </div>
      )}
      {/* ===== FRONT B: child name capture (B7) — one field, two optional
          chips, one button. Saved through the merged /api/auth/profile. ===== */}
      <ChildCaptureSheet
        open={capture.open}
        initial={capture.initial}
        tier={tier}
        onClose={() => setCapture({ open: false, initial: null })}
        onSaved={(serverChildren) => {
          onChildSave(serverChildren);
        }}
        onRemoved={onRemoved || (() => {})}
      />
    </section>
  );
}

function FileRow({ f, onOpen, flash }: { f: OrganizerFile; onOpen: () => void; flash?: boolean }) {
  const needsSorting = f.folder === "other" && f.category === "needs-sorting";
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${f.title || "document"} details`}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-cream-deep/70 ${flash ? "bys-needs-sorting-flash" : ""}`}
    >
      <FileIcon f={f} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{f.title || (f.kind === "text" ? "Pasted text" : isPdf(f) ? "PDF" : "Photo")}</span>
          {needsSorting && (
            <span className="shrink-0 rounded-md border border-amber-500/50 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Needs sorting</span>
          )}
        </span>
        <span className="mt-0.5 block line-clamp-1 text-sm text-stone">{snippet(f)}</span>
        <span className="mt-0.5 block text-sm text-taupe">
          {fmtDate(f.createdAt)} · {needsSorting ? "Needs a line from you" : `${folderLabel(f.folder)} › ${subfolderLabel(f.folder, f.category)}`}
        </span>
      </span>
      <IconChevronDown className="h-5 w-5 shrink-0 -rotate-90 text-forest-soft" />
    </button>
  );
}
