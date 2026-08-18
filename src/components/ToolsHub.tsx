// "Tools" — the Command Center workspace (5304729186 §8): ONE command list
// instead of the repetitive tool-card grid. Each row = name + one short line
// of state + one action. Export / Attorney Prep Pack open calm inline panels
// (selection → preview → export; package builder). Record Review runs directly
// and its report renders as one elevated document surface. No icon tiles, no
// badges, no full-width buttons repeated — this is a composition/copy pass
// only: every entitlement, lock CTA, analytics hook, and generation handler is
// preserved and passed in from the dashboard.

import { useState, type ReactNode } from "react";
import {
  IconAction,
  IconBook,
  IconCheck,
  IconDownload,
  IconGavel,
  IconHistory,
  IconOrganizer,
  IconReview,
} from "./icons";

type RowProps = {
  icon: ReactNode;
  name: string;
  state: string;
  action: ReactNode;
  onOpen?: () => void;
};

function WorkspaceRow({ icon, name, state, action, onOpen }: RowProps) {
  const inner = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-cream-deep text-forest-soft">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{name}</span>
        <span className="mt-0.5 block truncate text-sm text-stone">{state}</span>
      </span>
      <span className="shrink-0">{action}</span>
    </>
  );
  if (onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-150 hover:bg-cream-deep/50"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex w-full items-center gap-3 px-5 py-4">{inner}</div>;
}

function IncludedParts({ parts }: { parts: string[] }) {
  return (
    <ul className="divide-y divide-line/60">
      {parts.map((p) => (
        <li key={p} className="flex items-center gap-3 py-2.5">
          <IconCheck className="h-4 w-4 shrink-0 text-forest-soft" />
          <span className="text-base text-ink">{p}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ToolsHub({
  suiteUnlocked,
  organizerLive,
  organizerPill,
  canExport,
  attorneyPrepUnlocked,
  rrEnt,
  rrUsed,
  rrBusy,
  rrErr,
  rrReport,
  rrEntState,
  exportBusy,
  packBusy,
  packMsg,
  onOpenOrganizer,
  onOpenCaseSummary,
  onOpenActionCenter,
  onExport,
  onGeneratePack,
  onRunRecordReview,
  onDownloadRecordReview,
}: {
  tier: string;
  suiteUnlocked: boolean;
  organizerLive: boolean;
  organizerPill: string;
  canExport: boolean;
  attorneyPrepUnlocked: boolean;
  rrEnt: { entitled: boolean; kind?: string };
  rrUsed: boolean;
  rrBusy: boolean;
  rrErr: string;
  rrReport: any;
  rrEntState: any;
  exportBusy: boolean;
  packBusy: boolean;
  packMsg: string;
  onOpenOrganizer: () => void;
  onOpenCaseSummary: () => void;
  onOpenActionCenter: () => void;
  onExport: () => void;
  onGeneratePack: () => void;
  onRunRecordReview: () => void;
  onDownloadRecordReview: () => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const [prepOpen, setPrepOpen] = useState(false);
  const openExport = () => {
    setExportOpen((o) => !o);
    setPrepOpen(false);
  };
  const openPrep = () => {
    setPrepOpen((o) => !o);
    setExportOpen(false);
  };
  const seeCommandCenter = (
    <a href="/pricing" className="btn-ghost min-h-11 shrink-0 px-4 py-2 text-sm">
      See Command Center →
    </a>
  );
  const openBtn = (label: string, fn?: () => void) => (
    <button
      type="button"
      onClick={fn}
      className="btn-ghost min-h-11 shrink-0 px-4 py-2 text-sm"
    >
      {label}
    </button>
  );

  return (
    <section id="tools" className="mt-5">
      <h2 className="font-display text-2xl font-semibold text-forest">Tools</h2>
      <p className="mt-1 max-w-xl text-base text-stone">
        Everything that turns your saved record into something usable.
      </p>

      {/* ===== Command/workspace list (§8) — one row per tool ===== */}
      <div className="card mt-5 divide-y divide-line/70 overflow-hidden">
        <WorkspaceRow
          icon={<IconOrganizer className="h-5 w-5" />}
          name="The Organizer"
          state={organizerPill}
          onOpen={suiteUnlocked || organizerLive ? onOpenOrganizer : undefined}
          action={
            suiteUnlocked || organizerLive ? (
              openBtn("Open", onOpenOrganizer)
            ) : (
              seeCommandCenter
            )
          }
        />
        <WorkspaceRow
          icon={<IconBook className="h-5 w-5" />}
          name="Case Summary"
          state={suiteUnlocked ? "What your record shows right now." : "Part of Command Center."}
          onOpen={suiteUnlocked ? onOpenCaseSummary : undefined}
          action={suiteUnlocked ? openBtn("Open", onOpenCaseSummary) : seeCommandCenter}
        />
        <WorkspaceRow
          icon={<IconAction className="h-5 w-5" />}
          name="Action Center"
          state={suiteUnlocked ? "What needs your attention." : "Part of Command Center."}
          onOpen={suiteUnlocked ? onOpenActionCenter : undefined}
          action={suiteUnlocked ? openBtn("Open", onOpenActionCenter) : seeCommandCenter}
        />
        <WorkspaceRow
          icon={<IconDownload className="h-5 w-5" />}
          name="Export your record"
          state="Everything you've saved, in one file."
          onOpen={canExport ? openExport : undefined}
          action={
            canExport ? (
              openBtn(exportOpen ? "Close" : "Set up", openExport)
            ) : (
              seeCommandCenter
            )
          }
        />
        <WorkspaceRow
          icon={<IconGavel className="h-5 w-5" />}
          name="Attorney Prep Pack"
          state={attorneyPrepUnlocked ? "Unlocked — yours." : "One-time · $24.50"}
          onOpen={attorneyPrepUnlocked ? openPrep : undefined}
          action={
            attorneyPrepUnlocked ? (
              openBtn(prepOpen ? "Close" : "Build pack", openPrep)
            ) : (
              <a
                href="/pricing?tab=One-time"
                className="btn-ghost min-h-11 shrink-0 px-4 py-2 text-sm"
              >
                See Attorney Prep Pack →
              </a>
            )
          }
        />
        <WorkspaceRow
          icon={<IconHistory className="h-5 w-5" />}
          name="Record Review"
          state={
            rrEnt.entitled
              ? rrEnt.kind === "purchased"
                ? "Unlocked."
                : "1 included this year."
              : rrUsed
                ? "Used for this year."
                : "One-time · $29.50"
          }
          action={
            rrEnt.entitled ? (
              <button
                type="button"
                onClick={onRunRecordReview}
                disabled={rrBusy}
                className="btn-ghost min-h-11 shrink-0 px-4 py-2 text-sm"
              >
                {rrBusy ? "Reviewing…" : rrReport ? "Review again" : "Run review"}
              </button>
            ) : (
              <a
                href="/pricing?tab=One-time"
                className="btn-ghost min-h-11 shrink-0 px-4 py-2 text-sm"
              >
                {rrUsed ? "Buy another — $29.50" : "See Record Review →"}
              </a>
            )
          }
        />
        <WorkspaceRow
          icon={<IconReview className="h-5 w-5" />}
          name="Consultations"
          state="Learn from fathers who've navigated custody cases."
          action={
            <a
              href="/consultations"
              className="btn-ghost min-h-11 shrink-0 px-4 py-2 text-sm"
            >
              Book →
            </a>
          }
        />
      </div>
      {rrErr && (
        <p role="alert" className="mt-3 text-base text-red-800">
          {rrErr}
        </p>
      )}

      {/* ===== Export: selection → preview → export (§10) ===== */}
      {exportOpen && (
        <div className="card mt-4 overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h3 className="font-display text-xl font-semibold text-forest">Export your record</h3>
            <p className="mt-1 text-sm text-stone">Everything below, in one file.</p>
          </div>
          <div className="px-5 py-4">
            <IncludedParts
              parts={[
                "Saved reviews and analyses",
                "Communication Log",
                "Event Timeline",
                "Organizer documents",
                "Case Summary",
              ]}
            />
            <p className="mt-3 text-sm text-stone">
              One HTML file — opens in any browser, yours to keep.
            </p>
            <button
              type="button"
              onClick={onExport}
              disabled={exportBusy}
              className="btn-primary mt-4 w-full sm:w-auto"
            >
              {exportBusy ? "Preparing your file…" : "Download your record"}
            </button>
          </div>
        </div>
      )}

      {/* ===== Attorney Prep Pack: package builder (§11) ===== */}
      {prepOpen && (
        <div className="card mt-4 overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h3 className="font-display text-xl font-semibold text-forest">Attorney Prep Pack</h3>
            <p className="mt-1 text-sm text-stone">Your record, ready to hand over.</p>
          </div>
          <div className="px-5 py-4">
            <IncludedParts
              parts={[
                "Cover sheet",
                "Chronology of exchanges and events",
                "Evidence index",
                "Communication patterns",
                "Full record bundle",
              ]}
            />
            <p className="mt-3 text-sm text-stone">
              Built from what you've saved — reviews, log, timeline, and documents.
            </p>
            <button
              type="button"
              onClick={onGeneratePack}
              disabled={packBusy}
              className="btn-primary mt-4 w-full sm:w-auto"
            >
              {packBusy ? "Preparing your pack…" : "Generate pack"}
            </button>
            {packMsg && (
              <p role="alert" className="mt-2 text-base text-red-800">
                {packMsg}
              </p>
            )}
            <p className="mt-4 text-sm leading-relaxed text-stone">
              Not legal advice. Not legal representation. A record for you to share with your attorney.
            </p>
          </div>
        </div>
      )}

      {/* ===== Record Review: evidence-review workspace (§11) ===== */}
      {rrReport && (
        <div className="card mt-4 overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h3 className="font-display text-xl font-semibold text-forest">Record Review</h3>
              <p className="mt-1 text-sm text-stone">
                Read from your log, timeline, documents, and saved reviews.
                {rrReport.generatedAt
                  ? ` Updated ${new Date(rrReport.generatedAt).toLocaleDateString()}.`
                  : ""}
                {rrReport.fallback ? " Quick version (review engine busy)." : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={onDownloadRecordReview}
              className="btn-ghost min-h-11 px-4 text-sm"
            >
              Download report
            </button>
          </div>
          <iframe
            title="Record Review"
            srcDoc={rrReport.html}
            sandbox="allow-same-origin"
            className="h-96 w-full bg-white"
          />
          {rrEntState && rrEntState.kind === "ultimate" && !rrEntState.entitled && (
            <p className="border-t border-line px-5 py-3 text-sm text-stone">
              Your one Review for this year is used — this report is still yours to view and download.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
