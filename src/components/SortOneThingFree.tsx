// Landing "Sort one thing free" demo (owner 2026-08-11, build 2026-08-12).
// A fully CLIENT-SIDE, deterministic (rule-based) taste of the Organizer on
// the public landing page: zero endpoints, zero LLM cost, zero server state,
// zero abuse surface, cannot fail on a slow-provider evening. "Nothing is
// saved" is LITERALLY TRUE here — extraction runs in the browser, the only
// network write is an analytics beacon (vid + event + meta, NO content), and
// file bytes never leave the device.
//
// Honesty rails: no "AI" in any user-facing copy, no proactive limit warnings,
// no-OCR lines verbatim (a photo/scan can't be read — a line from the dad
// helps), classification is a suggestion, no outcome promises.
//
// Two-tap upload: tap the "Pick a paper" chip (no chunk load) → tap "Choose a
// paper" → pick a file. The ~1MB pdfjs lazy chunk loads ONLY when a PDF is
// actually extracted, because extractFile() dynamic-imports pdfjs/jszip inside
// its handlers — real uploaders pay it, casual scrollers never see it.

import { useEffect, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import { extractFile, type ExtractUnit } from "~/lib/extract";
import {
  fallbackOrganizerClassify,
  type OrganizerRuleResult,
} from "~/lib/ruleClassify";
import { folderLabel, subfolderLabel } from "~/lib/taxonomy";
import { IconOrganizer } from "./icons";

// Signed-in account CTA fix (P1 fast-follow 2026-08-12): the "Get the full
// Organizer" link must not bounce a signed-in dad through /login. Mirrors
// index.tsx's module-private useSignedIn (fetch /api/auth/me once per mount);
// while the check is pending we default to the signed-out href — safe for
// everyone (a signed-in click in that tiny window lands on /login, never a
// dead bounce).
function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    fetch("/api/auth/me")
      .then(async (r) => {
        if (r.status === 401) return false;
        if (!r.ok) return false;
        const j = await r.json().catch(() => null);
        return !!(j && j.user);
      })
      .catch(() => false)
      .then((v) => { if (mounted) setSignedIn(v); });
    return () => { mounted = false; };
  }, []);
  return signedIn;
}

type Mode = "text" | "file";
type Phase = "form" | "reading" | "needline" | "result";

// No-OCR lines verbatim (SortMyPile.tsx:373 / :321 / :438, OrganizerTrial.tsx:178).
const FILE_SUPPORT_LINE =
  "We read the text inside your PDFs, Word files, and .txt files. Photos and scanned papers still need a line from you — and file bytes never leave your phone.";
const CANNOT_READ_LINE = "Can't read this one — a line about it helps.";
const SCANNED_LINE =
  "Needs sorting — this one looks scanned, so we couldn't read its text.";
const FILE_BY_DESCRIPTION_LINE =
  "We file by what you tell us — add a line about what this is (we can't read the image itself yet).";
// Result honesty line (OrganizerTrial.tsx:201) — literally true client-side.
const NOTHING_SAVED_LINE =
  "This is a preview — nothing is saved or moved. You're the one who decides where it goes.";
// P2 demo chip (polish r1, QA 99d7894e): "Paste a message" is a mode toggle,
// so tapping it while already in text mode used to do nothing visible. Now it
// pastes a small calm sample (a real school-note shape — no fake claims, no
// invented numbers tied to the dad) so the tap always pays out. It never
// clobbers: if the dad already typed something, the sample appends below it.
const SAMPLE_NOTE =
  "School note: the teacher emailed — field trip permission slip and $40 due Friday. Parent-teacher conference is next week at 6pm.";

function unreadableLine(u: ExtractUnit): string {
  switch (u.blockReason) {
    case "oversize":
      return "That one's over 25 MB — try a smaller version.";
    case "nested-zip":
      return "That zip has another zip inside — try the file itself.";
    case "corrupt":
      return "We couldn't read that one — try another file, or paste the text.";
    case "empty":
      return SCANNED_LINE;
    case "unknown":
    default:
      return CANNOT_READ_LINE;
  }
}

export default function SortOneThingFree() {
  const [mode, setMode] = useState<Mode>("text");
  const [phase, setPhase] = useState<Phase>("form");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [page, setPage] = useState<{ p: number; n: number } | null>(null);
  const [desc, setDesc] = useState("");
  const [needLine, setNeedLine] = useState("");
  const [result, setResult] = useState<OrganizerRuleResult | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const signedIn = useSignedIn();

  // Analytics: the demo card is seen (once per mount).
  useEffect(() => {
    track("landing_sort_view", {});
  }, []);

  function classifyAndShow(source: string, kind: Mode) {
    const res = fallbackOrganizerClassify(source);
    setResult(res);
    setPhase("result");
    track("landing_sort_done", { kind, folder: res.folder });
  }

  function submitText() {
    if (phase === "reading") return;
    setErr("");
    if (!text.trim()) {
      setErr("Paste a message or a few lines from a paper to file first.");
      return;
    }
    track("landing_sort_started", { kind: "text" });
    classifyAndShow(text.trim(), "text");
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr("");
    setDesc("");
    setPage(null);
    const name = f.name.trim().slice(0, 120) || "paper";
    // Reserve the row NOW so the dad sees "Reading {name}…" the instant the
    // picker closes — pdfjs's lazy chunk may still be downloading.
    setFileName(name);
    setPhase("reading");
    track("landing_sort_started", { kind: "file" });
    let units: ExtractUnit[];
    try {
      units = await extractFile(f, {
        onPage: (p, n) => {
          if (n > 1) setPage({ p, n });
        },
      });
    } catch {
      units = [{ localId: "", name, text: "", fullText: "", readable: false, blockReason: "corrupt" }];
    }
    const readable = units.find((u) => u.readable);
    if (readable) {
      classifyAndShow(readable.text, "file");
      return;
    }
    // Nothing readable (photo, scanned PDF, oversize, corrupt, nested zip):
    // calm line + a one-line description path — no dead end, no OCR claims.
    const first = units[0] || { name, readable: false, blockReason: "unknown" as const };
    setNeedLine(unreadableLine(first));
    setPhase("needline");
  }

  function submitDescription() {
    if (!desc.trim()) {
      setErr("Add a line about what this is so we can file it honestly.");
      return;
    }
    setErr("");
    classifyAndShow(desc.trim(), "file");
  }

  const showResult = phase === "result" && result;

  return (
    <section className="mb-12 mt-12" aria-label="Sort one thing free">
      <div className="rounded-[2rem] border border-line bg-card p-6 shadow-card sm:p-8">
        <div className="flex items-center gap-2">
          <IconOrganizer className="h-5 w-5 text-forest-soft" />
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">The Organizer</p>
        </div>
        <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Where would this go? Try it with one thing.</h2>
        <p className="mt-2 text-base leading-relaxed text-stone">Paste a message from your co-parent, or pick a paper. We'll show you exactly which folder it belongs in.</p>

        {(phase === "form" || phase === "reading") && (
          <>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={phase === "reading"}
                onClick={() => {
                  setMode("text");
                  setErr("");
                  if (mode === "text" && phase === "form") {
                    setText((prev) => (prev.trim() ? prev + "\n\n" + SAMPLE_NOTE : SAMPLE_NOTE));
                  }
                }}
                className={`chip ${mode === "text" && phase === "form" ? "border-forest bg-forest text-cream" : ""}`}
              >
                Paste a message
              </button>
              <button
                type="button"
                disabled={phase === "reading"}
                onClick={() => { setMode("file"); setErr(""); }}
                className={`chip ${mode === "file" && phase === "form" ? "border-forest bg-forest text-cream" : ""}`}
              >
                Pick a paper →
              </button>
            </div>

            {mode === "text" ? (
              <div className="mt-5">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  maxLength={10000}
                  placeholder="Paste a message from your co-parent, or a few lines from a paper…"
                  className="min-h-36 w-full resize-y rounded-2xl border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
                />
                <button onClick={submitText} className="btn-primary mt-4 w-full text-lg">Show me where it goes</button>
                {err && <p role="alert" className="mt-4 text-base text-red-800">{err}</p>}
              </div>
            ) : (
              <div className="mt-5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-cream-deep px-4 py-2 text-base font-semibold text-forest transition hover:border-forest/40">
                  Choose a paper
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".txt,.pdf,.docx,.zip,image/png,image/jpeg,image/webp,image/heic"
                    className="sr-only"
                    onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
                  />
                </label>
                <p className="mt-3 text-sm leading-relaxed text-stone">{FILE_SUPPORT_LINE}</p>
                {phase === "reading" && (
                  <p role="status" aria-live="polite" className="mt-4 rounded-2xl border border-line bg-cream-deep/50 px-4 py-3 text-base text-stone">
                    {page && page.n > 1 ? `Reading page ${page.p} of ${page.n}…` : `Reading ${fileName}…`}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {phase === "needline" && (
          <div className="mt-5">
            <p role="status" aria-live="polite" className="rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-base text-amber-700">
              {fileName ? `${fileName} — ` : ""}{needLine}
            </p>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Daycare bill for February, $380 — the receipt from the center"
              className="mt-4 w-full resize-y rounded-2xl border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
            />
            <p className="mt-2 text-sm leading-relaxed text-stone">{FILE_BY_DESCRIPTION_LINE}</p>
            <button onClick={submitDescription} className="btn-primary mt-4 w-full text-lg">Show me where it goes</button>
            {err && <p role="alert" className="mt-4 text-base text-red-800">{err}</p>}
          </div>
        )}

        {showResult && (
          <div aria-live="polite" className="mt-6 rounded-3xl border border-forest/20 bg-cream-deep/60 p-6">
            <h3 className="font-display text-2xl font-semibold leading-snug text-forest">
              We'd file this under {folderLabel(result.folder)} › {subfolderLabel(result.folder, result.category)}
            </h3>
            <p className="mt-2 text-base leading-relaxed text-ink">{result.reason}</p>
            <p className="mt-1 text-base leading-relaxed text-stone">{result.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="chip border-forest bg-forest text-cream">{folderLabel(result.folder)}</span>
              <span className="chip border-line bg-card">{subfolderLabel(result.folder, result.category)}</span>
            </div>
            <p className="mt-4 border-t border-line/70 pt-4 text-sm leading-relaxed text-stone">{NOTHING_SAVED_LINE}</p>
          </div>
        )}

        {showResult && (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <a
              href="/pricing"
              onClick={() => track("landing_sort_cta", { target: "sortpile" })}
              className="btn-ghost flex-1 text-center"
            >
              Sort a whole pile of papers →
            </a>
            <a
              href={signedIn ? "/home?tab=organizer" : "/login?next=/home?tab=organizer"}
              onClick={() => track("landing_sort_cta", { target: "account" })}
              className="btn-primary flex-1 text-center"
            >
              Get the full Organizer
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
