// 11pm Lamp — "this one can wait until morning". A quiet, time-aware card on
// the landing review only: it appears when the review reads Heated/High
// conflict AND it is genuinely late (10pm–5am local — see isLateNight), and it
// offers to hold the draft on THIS device until morning. Calm, honest, zero
// urgency: it only restates the real score label and the real local-time
// window; "on this device" is exactly true (localStorage); saving never
// touches a review credit and needs no account. States: idle → saved → hidden.
import { useState } from "react";
import { track } from "~/lib/analytics";
import { addTomorrowDraft } from "~/lib/tomorrowDrafts";
import { IconClose, IconMoon } from "./icons";

export default function TomorrowLamp({
  draft,
  score,
  label,
  onSaved,
}: {
  draft: string;
  score: number;
  label: string;
  onSaved?: (drafts: unknown[]) => void;
}) {
  const [state, setState] = useState<"idle" | "saved" | "hidden">("idle");
  if (state === "hidden") return null;
  const save = () => {
    const next = addTomorrowDraft(draft);
    setState("saved");
    track("lamp_save", { score });
    onSaved?.(next);
  };
  const dismiss = () => {
    setState("hidden");
    track("lamp_dismiss", {});
  };
  // "Done" just hides the lamp — no track. The [×] button is the only
  // lamp_dismiss source (it means "dismissed the suggestion", not "finished").
  const done = () => {
    setState("hidden");
  };
  return (
    <div className="rounded-3xl border border-forest/20 bg-card p-6 shadow-card">
      {state === "idle" ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <IconMoon className="mt-1 h-5 w-5 shrink-0 text-forest-soft" />
              <h3 className="font-display text-2xl font-semibold leading-snug text-forest">It's late. This one can wait.</h3>
            </div>
            <button type="button" onClick={dismiss} className="icon-btn min-h-11 text-stone" aria-label="Dismiss"><IconClose className="h-5 w-5" /></button>
          </div>
          <p className="mt-3 text-base leading-relaxed text-stone">
            It reads {label} right now. Save it and look again in the morning — fresh eyes, same facts.
          </p>
          <button type="button" onClick={save} className="btn-primary mt-4 w-full min-h-12">Save it for tomorrow</button>
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-2xl font-semibold leading-snug text-forest">Saved for tomorrow.</h3>
            <button type="button" onClick={dismiss} className="icon-btn min-h-11 text-stone" aria-label="Dismiss"><IconClose className="h-5 w-5" /></button>
          </div>
          <p className="mt-3 text-base leading-relaxed text-stone">It's on this device — ready when you are.</p>
          <button type="button" onClick={done} className="btn-ghost min-h-11 text-forest w-full mt-4">Done</button>
        </>
      )}
    </div>
  );
}
