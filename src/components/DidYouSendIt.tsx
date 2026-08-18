import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import type { ResultBlock } from "./ReviewResults";
import { IconClose } from "./icons";

// Calm-loop slice 1 + 2 — the did-you-send-it loop. One tiny ask after a completed
// dashboard review ("Did you send it?"), a one-tap log when he says yes, then a
// casual tone picker. State machine:
//   ask       → default; fires did_send_prompt_shown once per completion
//   confirmed → after "Yes, sent" (one tap done — the casual next ask)
//   sent      → after a tone pick: "Sent — {Tone}. It's on your record." +
//               a score-locked calm praise line (score ≥ 85 only — never praise
//               a heated send) + "View Log →"
//   hidden    → "Not yet", silent dismiss, or [×] — no copy, no guilt, no follow-up
// A new review resets the whole thing via key={calmKey} (home.tsx remounts).
//
// Honesty rails: the log entry holds only what the dad claimed — his draft or
// the rewrite text he picked, his tone pick (or "reviewed" if he never picks).
// We never infer which rewrite he sent from copy clicks. "Not yet" is silent.

type ToneKey = "gentle" | "direct" | "firm" | "as-wrote";
const TONE_LABELS: Record<ToneKey, string> = {
  gentle: "Gentle",
  direct: "Direct",
  firm: "Firm but Neutral",
  "as-wrote": "My message",
};

type Props = {
  draft: string;               // the message that was reviewed
  blocks: ResultBlock[];       // to offer only rewrites that exist + their texts
  eventId?: string | null;     // from the /api/review-events POST; null if that failed
  score?: number | null;       // Impact Score, rides on did_send_yes meta
  tier: "free" | "steady" | "command" | "ultimate";
  onGoLog: () => void;         // home.tsx: setTab("log")
};

type State = "ask" | "confirmed" | "sent" | "hidden";

export default function DidYouSendIt({ draft, blocks, eventId, score, tier, onGoLog }: Props) {
  const [state, setState] = useState<State>("ask");
  const [pickedTone, setPickedTone] = useState<ToneKey | null>(null);
  // One ask at a time: defer while a .bys-sheet (capture/check-in sheet) is on
  // the page — same guard pattern as ReviewResults. Covers both the landing
  // capture sheet (bys:capture-ask-* events) and the check-in sheet (mutation).
  const [deferred, setDeferred] = useState(false);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setDeferred(!!document.querySelector(".bys-sheet"));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
    const open = () => setDeferred(true);
    const closed = () => setDeferred(false);
    window.addEventListener("bys:capture-ask-open", open);
    window.addEventListener("bys:capture-ask-closed", closed);
    return () => {
      mo.disconnect();
      window.removeEventListener("bys:capture-ask-open", open);
      window.removeEventListener("bys:capture-ask-closed", closed);
    };
  }, []);

  // did_send_prompt_shown fires once per completion (remount via calmKey), only
  // when the ask is actually visible (not hidden behind a sheet).
  const shownFired = useRef(false);
  useEffect(() => {
    if (state === "ask" && !deferred && !shownFired.current) {
      shownFired.current = true;
      track("did_send_prompt_shown", { plan: tier });
    }
  }, [state, deferred, tier]);

  // send_confidence_shown fires once per completion when the sent-state first
  // renders (and not while deferred behind a sheet), carrying plan/tone/score.
  const confShownFired = useRef(false);
  useEffect(() => {
    if (state === "sent" && !deferred && !confShownFired.current) {
      confShownFired.current = true;
      track("send_confidence_shown", { plan: tier, tone: pickedTone ?? undefined, score: score ?? undefined });
    }
  }, [state, deferred, tier, pickedTone, score]);

  // Rewrite texts by tone id, straight from the blocks (offer only what exists).
  const rewriteText = useMemo(() => {
    const map: Partial<Record<ToneKey, string>> = {};
    let current: string | null = null;
    for (const b of blocks) {
      if (b.kind === "rewrite") current = b.id;
      else if (b.kind === "rwtext" && current) {
        map[current as ToneKey] = (map[current as ToneKey] ?? "") + (map[current as ToneKey] ? "\n" : "") + b.text;
      }
    }
    return map;
  }, [blocks]);
  const toneChips: ToneKey[] = (["gentle", "direct", "firm"] as ToneKey[]).filter(
    (k) => (rewriteText[k] ?? "").trim().length > 0
  );
  toneChips.push("as-wrote");

  // The one-tap log POST is fired on "Yes, sent" but the UI never waits on it
  // (calm: instant reward; network failures silently degrade). The promise is
  // memoized so a fast tone tap awaits the same request and PATCHes that id —
  // and if the POST ultimately failed, the tone tap falls back to POSTing the
  // entry directly with the picked tone (honest: the entry carries what he
  // picked, never an inferred rewrite).
  const logPromise = useRef<Promise<string | null> | null>(null);
  const ensureLog = (): Promise<string | null> => {
    if (!logPromise.current) {
      logPromise.current = (async () => {
        try {
          const r = await fetch("/api/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: draft,
              direction: "sent",
              date: new Date().toISOString(),
              topic: "other",
              tone: "reviewed",
              notes: "Auto-logged after a review.",
            }),
          });
          const j = await r.json().catch(() => ({}));
          const id: string | null = j?.log?.id ?? null;
          return id;
        } catch {
          return null;
        }
      })();
    }
    return logPromise.current;
  };

  // L2: read eventId from a latest-value ref (not the render closure) so a tap
  // that lands between the event POST resolving and this component re-rendering
  // still PATCHes the event; and if "Yes, sent" was tapped BEFORE the POST
  // resolved (eventId still null), the effect below fires the PATCH as soon as
  // the id arrives. patchedRef keeps the PATCH at exactly one fire.
  const eventIdRef = useRef(eventId);
  eventIdRef.current = eventId;
  const patchedRef = useRef(false);
  const fireSentPatch = () => {
    const evId = eventIdRef.current;
    if (!evId || patchedRef.current) return;
    patchedRef.current = true;
    fetch(`/api/review-events/${evId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentStatus: "sent" }),
    }).catch(() => {});
  };
  useEffect(() => {
    if (state === "confirmed" && eventId) fireSentPatch();
  }, [state, eventId]);
  const confirmSent = () => {
    track("did_send_yes", { plan: tier, score: score ?? undefined });
    fireSentPatch();
    void ensureLog();
    setState("confirmed");
  };

  const notYet = () => {
    track("did_send_no", { plan: tier });
    setState("hidden");
  };

  const pickTone = async (k: ToneKey) => {
    track("did_send_tone", { plan: tier, tone: k });
    const message = k === "as-wrote" ? draft : (rewriteText[k] ?? "").trim() || draft;
    const tone = k === "as-wrote" ? "as-wrote" : k;
    const id = await ensureLog();
    if (id) {
      fetch(`/api/log/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tone, message }),
      }).catch(() => {});
    } else {
      // The one-tap POST failed — record the entry now with the final pick so
      // the record is still honest (message + tone he chose).
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          direction: "sent",
          date: new Date().toISOString(),
          topic: "other",
          tone,
          notes: "Auto-logged after a review.",
        }),
      }).catch(() => {});
    }
    setPickedTone(k);
    setState("sent");
  };

  if (deferred) return null;
  if (state === "hidden") return null;

  if (state === "sent") {
    const label = pickedTone ? TONE_LABELS[pickedTone] : null;
    return (
      <div className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-base font-semibold text-forest">
            {label ? `Sent — ${label}. It's on your record.` : "Sent. It's on your record."}
          </p>
          <button type="button" onClick={onGoLog} className="min-h-11 shrink-0 text-base font-semibold text-forest underline underline-offset-4">
            View Log →
          </button>
        </div>
        <p className="mt-1 text-base text-stone">
          {(score ?? null) !== null && score! >= 85
            ? "That one read calm — worth keeping on record."
            : "Find it anytime under Log."}
        </p>
      </div>
    );
  }

  if (state === "confirmed") {
    return (
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-semibold text-forest">Logged — it&apos;s on your record.</p>
            <p className="mt-1 text-base text-stone">Find it anytime under Log.</p>
          </div>
          <button type="button" onClick={() => setState("hidden")} className="icon-btn min-h-11 shrink-0 text-stone" aria-label="Dismiss" title="Leave it as reviewed">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-4 text-base font-medium text-forest">Which one went out?</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {toneChips.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => void pickTone(k)}
              className="chip min-h-11"
            >
              {TONE_LABELS[k]}
            </button>
          ))}
        </div>
        {tier === "free" && (
          <a href="/pricing" className="mt-4 inline-flex text-base font-semibold text-forest underline underline-offset-4">
            Want every review kept forever? Steady — $4.99/mo →
          </a>
        )}
      </div>
    );
  }

  // state === "ask"
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-lg font-semibold text-forest">Did you send it?</p>
        <button type="button" onClick={() => setState("hidden")} className="icon-btn min-h-11 shrink-0 text-stone" aria-label="Dismiss">
          <IconClose className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-1 text-base text-stone">One tap either way — this just keeps your record accurate.</p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={confirmSent} className="btn-primary min-h-12 text-base">
          Yes, sent
        </button>
        <button type="button" onClick={notYet} className="btn-ghost min-h-12 text-base">
          Not yet
        </button>
      </div>
    </div>
  );
}
