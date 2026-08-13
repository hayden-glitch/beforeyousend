// "Saved for tomorrow" list — the device-local drafts from the 11pm Lamp,
// readable from BOTH the landing paste box and the dashboard ai tab so a draft
// saved at 11:47pm is actionable in the morning. Renders only when drafts
// exist (never an empty-state). Load fills the paste box and the draft stays
// (not consumed — he can load it again); [×] removes instantly, no confirm (a
// device-local draft is low-stakes). Honest framing: "On this device".
import { useEffect, useState } from "react";
import { track } from "~/lib/analytics";
import { readTomorrowDrafts, removeTomorrowDraft, type TomorrowDraft } from "~/lib/tomorrowDrafts";
import { IconClose } from "./icons";

export default function TomorrowDraftsList({ onLoad }: { onLoad: (text: string) => void }) {
  const [drafts, setDrafts] = useState<TomorrowDraft[]>([]);
  useEffect(() => {
    setDrafts(readTomorrowDrafts());
  }, []);
  if (drafts.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Saved for tomorrow</p>
      <p className="mt-1 text-base text-stone">On this device — they're yours.</p>
      <div className="mt-3 space-y-3">
        {drafts.map((d) => (
          <div key={d.id} className="rounded-3xl border border-line bg-cream-deep/50 p-4">
            <p className="line-clamp-2 text-base text-ink">{d.text}</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-sm text-stone">
                {new Date(d.savedAt).toLocaleDateString()} · {new Date(d.savedAt).toLocaleTimeString()}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => { onLoad(d.text); track("tomorrow_draft_loaded", {}); }}
                  className="btn-ghost min-h-11 text-forest"
                >
                  Load
                </button>
                <button
                  type="button"
                  aria-label="Remove draft"
                  onClick={() => { setDrafts(removeTomorrowDraft(d.id)); track("tomorrow_draft_removed", {}); }}
                  className="icon-btn min-h-11 text-stone"
                >
                  <IconClose className="h-5 w-5" />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
