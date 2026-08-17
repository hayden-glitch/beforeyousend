// "Sort My Pile" — one-time pack ($19.50): REAL CONTENT SORT of up to 50 papers
// into the dad's REAL Organizer folders. The client reads each paper's OWN text
// on-device (PDFs page by page, .txt, .docx, and .zip containers — each file
// inside a zip sorts as its own paper) and sends up to 10k chars per paper;
// the server classifies each from its full text (LLM with rule fallback).
// Photos and scanned papers have no readable text — they're marked "Can't read
// this one — a line about it helps." and take the honest needs-sorting path.
// File bytes never leave the device.
// Flow (calm, one tiny ask at a time): "Got a pile?" → add papers (native
// multi-file picker; rows flip Reading… → Read ✓ as extraction completes) →
// optional one-word pile label → "Sort my pile" → the server files everything
// and returns the full result set in ONE response per POST (synchronous; big
// text piles >20 papers are sent in calm chunks of 20 and merged). While in
// flight we show "Reading your papers…"/"Filing {name}…"; results reveal
// locally at a calm ~1.5s cadence → folder cards + amber "Needs sorting"
// fallback. Unentitled dads get the honest 402 message + buy card instead.
import { useEffect, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import { folderLabel, subfolderLabel } from "~/lib/taxonomy";
import { extractFile, MAX_SEND_CHARS } from "~/lib/extract";
import { paymentSurfaceAvailable, runCheckout, type CheckoutOpening } from "~/lib/checkout";
import PaymentSurface from "~/components/PaymentSurface";
import { IconArrowLeft, IconCheck, IconClose, IconOrganizer, IconPlus } from "./icons";

const MAX_PAPERS = 50;
const MAX_DESC = 500;
const FILE_STEP_MS = 1500; // calm local visual pacing while a paper "files"
const POST_CHUNK = 20; // >20 text papers → chunked POSTs (60s serverless budget)

type Paper = {
  localId: string;
  name: string;
  description: string;
  status: "reading" | "read" | "unreadable";
  text?: string; // extracted text (<=10k, only when readable)
  page?: { p: number; n: number };
  blockReason?: string;
  fromZip?: string; // zip name when this paper came out of a container
};

type SortResult = {
  name: string;
  folder: string | null;
  category?: string | null;
  title?: string;
  summary?: string | null;
  needsSorting: boolean;
  filed: boolean;
  reason?: string;
  skipped?: string;
};
type SortDone = {
  status: "done";
  results: SortResult[];
  filed: number;
  needsSorting: number;
  skipped: number;
  total?: number;
};

export default function SortMyPile({
  tier,
  sortUntilActive,
  onBack,
  onOpenOrganizer,
}: {
  tier: string;
  sortUntilActive: boolean;
  onBack: () => void;
  onOpenOrganizer: () => void;
}) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [pileLabel, setPileLabel] = useState("");
  const [phase, setPhase] = useState<"pile" | "running" | "results">("pile");
  const [result, setResult] = useState<SortDone | null>(null);
  const [needPurchase, setNeedPurchase] = useState(false);
  const [purchaseMsg, setPurchaseMsg] = useState("");
  const [error, setError] = useState("");
  const [buyBusy, setBuyBusy] = useState(false);
  // Slice 2b: custom-mode opening renders the branded in-app payment surface.
  const [payOutcome, setPayOutcome] = useState<CheckoutOpening | null>(null);
  const [zipNote, setZipNote] = useState("");
  const [displayDone, setDisplayDone] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    track("sortpile_view", { plan: tier });
  }, [tier]);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (phase !== "running" || !result) return;
    if (reducedMotion) {
      setDisplayDone(result.results.length);
      setPhase("results");
      return;
    }
    const iv = setInterval(() => {
      setDisplayDone((d) => Math.min(d + 1, result.results.length));
    }, FILE_STEP_MS);
    return () => clearInterval(iv);
  }, [phase, result, reducedMotion]);

  useEffect(() => {
    if (phase === "running" && result && displayDone >= result.results.length) {
      const t = setTimeout(() => setPhase("results"), 350);
      return () => clearTimeout(t);
    }
  }, [phase, result, displayDone]);

  function patchPaper(localId: string, patch: Partial<Paper>) {
    setPapers((prev) => prev.map((p) => (p.localId === localId ? { ...p, ...patch } : p)));
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    const fresh = crypto.randomUUID();
    track("sortpile_extract_start", { n: picked.length });
    let addedUnits = 0;
    let blocked = 0;
    let totalChars = 0;
    for (const f of picked) {
      const baseName = f.name.trim().slice(0, 120);
      if (!baseName) continue;
      // Reserve a row now so the dad sees "Reading {name}…" immediately.
      const rowId = fresh + "-" + Math.random().toString(36).slice(2);
      setPapers((prev) => {
        if (prev.length >= MAX_PAPERS) return prev;
        if (prev.some((p) => p.name === baseName)) return prev;
        return [...prev, { localId: rowId, name: baseName, description: "", status: "reading" }];
      });
      const units = await extractFile(f, {
        onPage: (p, n) => { if (n > 1) patchPaper(rowId, { page: { p, n } }); },
      });
      for (const u of units) {
        const uName = u.name.slice(0, 120);
        // ZIP expansion: the zip's own placeholder row is replaced by one row
        // per contained file (dedupe by the entry's RELATIVE PATH, not basename
        // — two same-basename files in different zip folders are both kept).
        setPapers((prev) => {
          const next = prev.filter((p) => p.name !== baseName && !(p.fromZip === baseName && p.name === uName));
          if (next.length >= MAX_PAPERS) return next;
          if (next.some((p) => p.name === uName)) return next;
          const paper: Paper = u.readable
            ? { localId: fresh + "-" + Math.random().toString(36).slice(2), name: uName, description: "", status: "reading", text: u.text, fromZip: units.length > 1 ? baseName : undefined }
            : { localId: fresh + "-" + Math.random().toString(36).slice(2), name: uName, description: "", status: "unreadable", blockReason: u.blockReason, fromZip: units.length > 1 ? baseName : undefined };
          return [...next, paper];
        });
        addedUnits++;
        if (u.readable) totalChars += u.text.length;
        else blocked++;
      }
      // Mark this pick's rows as read/unreadable once extraction finished.
      setPapers((prev) => {
        const ours = prev.filter((p) => p.localId.startsWith(fresh + "-"));
        return prev.map((p) => {
          if (!p.localId.startsWith(fresh + "-")) return p;
          const done = ours.find((o) => o.name === p.name);
          if (!done) return p;
          if (done.status === "unreadable") return { ...p, status: "unreadable" as const, blockReason: done.blockReason };
          return { ...p, status: "read" as const, text: done.text };
        });
      });
      if (units.length > 1) setZipNote(units.length + " papers found inside " + baseName + " — each one files on its own.");
    }
    track("sortpile_extract_done", { n: addedUnits, chars: totalChars });
    if (blocked > 0) track("sortpile_extract_blocked", { reason: "unreadable:" + blocked });
  }

  function removePaper(localId: string) {
    setPapers((prev) => prev.filter((p) => p.localId !== localId));
  }

  function setDesc(localId: string, value: string) {
    setPapers((prev) => prev.map((p) => (p.localId === localId ? { ...p, description: value.slice(0, MAX_DESC) } : p)));
  }

  async function buySortPile() {
    setBuyBusy(true);
    setPurchaseMsg("");
    // Shared coordinator: auth-first (signed-out/expired sessions go straight
    // to /login?next= and resume after sign-in), in-flight locked, errors land
    // in the purchase card right here.
    const outcome = await runCheckout({
      plan: "sortpile",
      source: "sortpile",
      setBusy: setBuyBusy,
      onError: (m) => setPurchaseMsg(m || "Checkout is not available right now."),
    });
    if (outcome.state === "opening") {
      if (paymentSurfaceAvailable(outcome)) { setPayOutcome(outcome); return; }
      if (outcome.url) location.href = outcome.url;
    }
  }

  async function postChunk(chunk: Paper[]): Promise<SortDone> {
    const r = await fetch("/api/organizer/sort", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: chunk.map((p) => ({
          name: p.name,
          description: p.description || undefined,
          text: p.status === "read" && p.text ? p.text.slice(0, MAX_SEND_CHARS) : undefined,
        })),
        pileLabel: pileLabel.trim() || undefined,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 402) {
      setPhase("pile");
      setNeedPurchase(true);
      setPurchaseMsg(d.error || "Sort My Pile is a one-time purchase — $19.50. It sorts up to 50 papers into your folders.");
      return { status: "done", results: [], filed: 0, needsSorting: 0, skipped: 0, total: 0 };
    }
    if (!r.ok || d?.status !== "done" || !Array.isArray(d.results)) {
      throw new Error(d?.error || "We couldn't sort the pile — try again in a moment.");
    }
    return d;
  }

  async function startSort() {
    setError("");
    setNeedPurchase(false);
    setPurchaseMsg("");
    track("sortpile_started", { n: papers.length });
    setResult(null);
    setDisplayDone(0);
    setPhase("running");
    try {
      // Papers with readable text are sent in calm chunks (the 60s serverless
      // budget covers ~20 LLM-classified papers per request at pool concurrency
      // 4); unreadable papers ride along with the first chunk. Results merge.
      const textPapers = papers.filter((p) => p.status === "read" && p.text);
      const noTextPapers = papers.filter((p) => p.status !== "read" || !p.text);
      const chunks: Paper[][] = [];
      if (noTextPapers.length > 0) chunks.push(noTextPapers);
      for (let i = 0; i < textPapers.length; i += POST_CHUNK) chunks.push(textPapers.slice(i, i + POST_CHUNK));
      const allResults: SortResult[] = [];
      let filed = 0, needsSorting = 0, skipped = 0;
      for (let c = 0; c < chunks.length; c++) {
        const d = await postChunk(chunks[c]);
        allResults.push(...d.results);
        filed += d.filed || 0;
        needsSorting += d.needsSorting || 0;
        skipped += d.skipped || 0;
      }
      const merged: SortDone = { status: "done", results: allResults, filed, needsSorting, skipped, total: papers.length };
      setResult(merged);
      setDisplayDone(0);
    } catch (err) {
      setPhase("pile");
      setError(err instanceof Error ? err.message : "We couldn't sort the pile — try again in a moment.");
    }
  }

  function reset() {
    setPapers([]);
    setPileLabel("");
    setPhase("pile");
    setResult(null);
    setError("");
    setDisplayDone(0);
  }

  const filedCount = result?.filed ?? 0;
  const skippedCount = result?.skipped ?? 0;

  return (
    <section className="mt-5 rounded-[2rem] border border-line bg-card p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-2">
        <IconOrganizer className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Sort My Pile</p>
      </div>

      {phase === "pile" && (
        <>
          <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Got a pile?</h2>
          <p className="mt-2 text-base leading-relaxed text-stone">
            Pick the papers — school notices, bills, emails, court docs — and we'll file each one into its folder. Up to 50 at a time.
          </p>
          {sortUntilActive && (
            <p className="mt-3 rounded-2xl border border-forest/20 bg-cream-deep/60 px-4 py-3 text-base text-forest">
              Your Organizer is live — 30 days included with Sort My Pile.
            </p>
          )}

          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }}
            aria-hidden="true"
            tabIndex={-1}
          />
          <button onClick={() => fileRef.current?.click()} className="btn-ghost mt-5 w-full text-forest">
            <IconPlus className="h-5 w-5" />
            {papers.length === 0 ? "Add papers" : "Add more papers"}
          </button>
          <p className="mt-2 text-sm leading-relaxed text-stone">
            {papers.length === 0
              ? "Most papers sort themselves — we read the text in PDFs, Word files, and .txt. Photos can't be read yet — one line about what they show helps."
              : `${papers.length} of ${MAX_PAPERS} papers`}
          </p>

          {papers.length > 0 && (
            <div className="mt-4 space-y-3">
              {papers.map((p, i) => (
                <div key={p.localId} className="rounded-2xl border border-line bg-cream-deep/50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 break-words text-base font-semibold text-forest">
                      {i + 1}. {p.name}
                    </p>
                    <button onClick={() => removePaper(p.localId)} className="icon-btn shrink-0 text-stone" aria-label={`Remove ${p.name}`}>
                      <IconClose className="h-5 w-5" />
                    </button>
                  </div>
                  <p className={`mt-1 text-sm ${p.status === "unreadable" ? "text-amber-700" : p.status === "reading" ? "text-stone" : "text-forest-soft"}`} role="status" aria-live="polite">
                    {p.status === "reading" ? (p.page && p.page.n > 1 ? `Reading page ${p.page.p} of ${p.page.n}…` : `Reading ${p.name}…`) : p.status === "read" ? "Read ✓" : "Can't read this one — a line about it helps."}
                  </p>
                  {p.fromZip && p.status !== "reading" && (
                    <p className="mt-1 text-sm text-stone">From {p.fromZip}</p>
                  )}
                  <input
                    value={p.description}
                    onChange={(e) => setDesc(p.localId, e.target.value)}
                    maxLength={MAX_DESC}
                    placeholder="One line about what it is (helps us file it)"
                    className="mt-2 min-h-11 w-full rounded-xl border border-line bg-cream px-4 py-2 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
                  />
                </div>
              ))}
              {zipNote && (
                <p className="rounded-2xl bg-forest/5 border border-forest/20 px-4 py-3 text-sm text-forest" role="status">{zipNote}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex-1">
                  <span className="field-label">Pile label (one word — optional)</span>
                  <input
                    value={pileLabel}
                    onChange={(e) => setPileLabel(e.target.value.slice(0, 40))}
                    placeholder="school · court · bills"
                    className="min-h-12 w-full rounded-xl border border-line bg-cream px-5 py-3 text-base text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
                  />
                </label>
              </div>
            </div>
          )}

          <button onClick={() => void startSort()} disabled={papers.length === 0} className="btn-primary mt-5 w-full text-lg">
            Sort my pile
          </button>
          {error && <p role="alert" className="mt-4 text-base text-red-800">{error}</p>}

          {needPurchase && (
            <div className="mt-6 rounded-3xl border border-forest/20 bg-cream-deep/60 p-6">
              <p className="text-lg font-semibold text-forest">One-time — no subscription.</p>
              <p className="mt-1 text-base leading-relaxed text-stone">{purchaseMsg}</p>
              <button onClick={buySortPile} disabled={buyBusy} className="btn-primary mt-4 w-full text-lg">
                {buyBusy ? "Opening checkout…" : "Buy Sort My Pile — $19.50"}
              </button>
              <a href="/pricing" className="btn-ghost mt-2 w-full text-forest">Or Command Center — $12.49/mo, unlimited filing</a>
              <button onClick={() => setNeedPurchase(false)} className="mt-3 w-full text-sm text-stone underline underline-offset-4">Not now — I'll keep my pile</button>
            </div>
          )}

          <button onClick={onBack} className="mt-6 inline-flex items-center gap-2 text-base font-semibold text-forest">
            <IconArrowLeft className="h-4 w-4" /> Back to the Organizer
          </button>
          <p className="mt-6 rounded-2xl bg-cream-deep/60 px-4 py-3 text-sm leading-relaxed text-stone">
            We read the text inside your PDFs, Word files, and .txt files. Photos and scanned papers still need a line from you — and file bytes never leave your phone.
          </p>
        </>
      )}

      {phase === "running" && (
        <>
          {!result ? (
            <>
              <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Reading your papers…</h2>
              <p className="mt-2 text-base leading-relaxed text-stone">
                One moment — we're filing your papers into their folders.
              </p>
              <div className="mt-5 flex items-center gap-3 rounded-2xl border border-line bg-cream-deep/40 px-4 py-3" role="status" aria-live="polite">
                <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-forest/30 border-t-forest" aria-hidden="true" />
                <p className="text-base text-stone">This usually takes a few seconds.</p>
              </div>
              <p className="mt-5 rounded-2xl bg-cream-deep/60 px-4 py-3 text-sm leading-relaxed text-stone">
                Filed from the text inside each paper — file bytes never leave your phone.
              </p>
            </>
          ) : (
            <>
              <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Filing your pile…</h2>
              <p className="mt-2 text-base leading-relaxed text-stone">
                {displayDone} of {result.results.length} papers — one at a time.
              </p>
              <div className="mt-5 space-y-2" role="status" aria-live="polite">
                {papers.map((p, i) => {
                  const isFiled = i < displayDone;
                  const isNext = i === displayDone && displayDone < result.results.length;
                  return (
                    <div key={p.localId} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 transition ${isFiled ? "border-forest/25 bg-forest/5" : "border-line bg-cream-deep/40"}`}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${isFiled ? "bg-forest text-cream" : isNext ? "bg-forest/15 text-forest" : "bg-cream-deep text-taupe"}`}>
                        {isFiled ? <IconCheck className="h-4 w-4" /> : <IconOrganizer className="h-4 w-4" />}
                      </span>
                      <p className={`min-w-0 flex-1 truncate text-base ${isFiled ? "text-ink" : "text-stone"}`}>{p.name}</p>
                      <span className="shrink-0 text-sm text-stone">{isFiled ? "filed" : isNext ? "filing…" : "waiting"}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-5 rounded-2xl bg-cream-deep/60 px-4 py-3 text-sm leading-relaxed text-stone">
                Filed from the text inside each paper — file bytes never leave your phone.
              </p>
            </>
          )}
        </>
      )}

      {phase === "results" && result && (
        <>
          <h2 className="mt-3 font-display text-3xl font-semibold text-forest">
            {filedCount > 0 ? `${filedCount} paper${filedCount === 1 ? "" : "s"} filed.` : "Your pile is sorted."}
          </h2>
          <p className="mt-2 text-base leading-relaxed text-stone">
            Every paper is now in your Organizer — folders you can open any time for the next 30 days.
          </p>
          <div className="mt-5 space-y-3">
            {result.results.map((r, i) => {
              const needs = r.needsSorting;
              return (
                <div key={`${r.name}-${i}`} className={`rounded-2xl border p-4 ${needs ? "border-amber-500/30 bg-amber-500/5" : "border-line bg-cream-deep/50"}`}>
                  <p className="text-base font-semibold text-forest">{r.title || r.name}</p>
                  {needs ? (
                    <p className="mt-1 text-base text-amber-700">Needs sorting — this one looks scanned, so we couldn't read its text.</p>
                  ) : (
                    <p className="mt-1 text-base text-stone">
                      <span className="font-semibold text-forest">{r.folder ? folderLabel(r.folder) : ""}{r.category ? ` › ${subfolderLabel(r.folder || "", r.category)}` : ""}</span>
                      {r.summary ? ` — ${r.summary}` : ""}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {skippedCount > 0 && (
            <p className="mt-4 rounded-2xl bg-cream-deep/60 px-4 py-3 text-base leading-relaxed text-stone">
              {skippedCount} paper{skippedCount === 1 ? "" : "s"} weren't filed — the Organizer holds 500 documents and it's full right now. Delete a few and sort again.
            </p>
          )}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button onClick={onOpenOrganizer} className="btn-primary">See them in The Organizer →</button>
            <button onClick={reset} className="btn-ghost text-forest">Sort another pile</button>
          </div>
          <p className="mt-5 rounded-2xl bg-cream-deep/60 px-4 py-3 text-sm leading-relaxed text-stone">
            Each paper was read and filed on its own. Photos and scans are marked so you can add a line.
          </p>
        </>
      )}
      {payOutcome && <PaymentSurface outcome={payOutcome} onClose={() => setPayOutcome(null)} onError={(m) => setPurchaseMsg(m || "Checkout is not available right now.")} />}
    </section>
  );
}
