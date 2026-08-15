// "The Organizer" free-trial panel (promo MVP). Dashboard card surface only
// (home.tsx opens tab==="organizer" for the cookie test group). Copy per
// /home/team/shared/organizer-promo-copy-design.md §2 + §4 — verbatim where
// marked. Public name is "The Organizer"; no "AI" in any user-facing copy.
// Honesty rails: five free items ever (1→5, preflight 766ccd02), nothing is
// saved, classification is a suggestion, no outcome promises, no fake urgency.
// Do NOT call recordSurface() from the upsell (keeps the Ultimate SpecialOffer
// modal out of this path).
// 5-Paper Trial (2026-08-12): the up-to-5 results ACCUMULATE visibly in
// component state within the session (D1 — a growing stack of filed cards, so
// "look, your folders are forming" is true to what he sees). On reload it
// resets; the copy never implies otherwise. "Name it: … keep / edit" is a
// LOCAL flourish only — real renaming lives in the paid Organizer drawer.
// Upsell only after item 5 (remaining hits 0), never before.

import { useEffect, useRef, useState } from "react";
import { track } from "~/lib/analytics";
import { TAXONOMY, folderLabel, subfolderLabel } from "~/lib/taxonomy";
import { IconCheck, IconOrganizer } from "./icons";
import { RecordHealthTeaser } from "./RecordHealth";
import {
  fileToDataUrl,
  runOrganizerTrial,
  startCommandCheckout,
  useOrganizerPromo,
} from "~/lib/organizer";

type Phase = "form" | "busy" | "result" | "blocked";

const AMBIGUOUS_COPY =
  "We couldn't tell what this is — it happens. File it yourself when the Organizer is live.";
// Mirrors the server's 402 copy (server-api ORGANIZER_TRIAL_402) — the
// used-state panel opens straight to the calm "demo used" message + upsell.
// The gate regex in submit() (/5 free organizer trials/) MUST stay in sync.
const USED_COPY =
  "You've used your 5 free organizer trials. The full Document Organizer is part of the Command Center plan.";
const TRIAL_LIMIT = 5;

type FiledCard = {
  folder: string;
  category: string;
  reason: string;
  title: string;
  localTitle: string;
  kept: boolean;
  editing: boolean;
};

// One-tap starter chips (5-Paper Trial): each fills the paste box with a
// realistic snippet + description and switches to text mode, so a tap is one
// ask away from a filing. NOT the aria-hidden decorative folderChips row.
const STARTER_CHIPS: { label: string; text: string; description: string }[] = [
  { label: "Last text from her", text: "I can't take them Friday night — you'll have to sort it out.", description: "The last text she sent about the kids" },
  { label: "Daycare-school bill", text: "Daycare bill for February, $380 — the receipt from Little Sprouts Center.", description: "Daycare bill from Little Sprouts Center, February" },
  { label: "School email", text: "School email: parent-teacher conference next Thursday at 4pm — please confirm who's coming.", description: "Email from the school about a parent-teacher conference" },
];

export default function OrganizerTrial({ trialRemaining = TRIAL_LIMIT }: { trialRemaining?: number }) {
  const promo = useOrganizerPromo();
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("");
  const [dataUrl, setDataUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [phase, setPhase] = useState<Phase>(trialRemaining > 0 ? "form" : "blocked");
  const [cards, setCards] = useState<FiledCard[]>([]);
  const [trial, setTrial] = useState<{ used: boolean; remaining: number; count?: number } | null>(
    trialRemaining > 0 ? null : { used: true, remaining: 0 }
  );
  const [err, setErr] = useState(trialRemaining > 0 ? "" : USED_COPY);
  const [fileErr, setFileErr] = useState("");
  const [upsellDeclined, setUpsellDeclined] = useState(false);
  const [pulseIdx, setPulseIdx] = useState<number | null>(null);
  const [firstFileMsg, setFirstFileMsg] = useState(false);
  const seenCountRef = useRef<number | null>(null);
  const upsellFiredRef = useRef(false);

  // trialRemaining can arrive after mount (auth/me resolves after a fast card
  // tap): upgrade the still-unused form to the used-state panel rather than
  // leaving the dad a form that would only 402 on submit.
  useEffect(() => {
    if (trialRemaining <= 0 && phase === "form") {
      setPhase("blocked");
      setErr(USED_COPY);
      setTrial({ used: true, remaining: 0 });
    }
  }, [trialRemaining, phase]);

  const remainingNow =
    typeof trial?.remaining === "number" ? trial.remaining : Math.max(0, trialRemaining);
  const showUpsell = !upsellDeclined && remainingNow === 0 && phase !== "form" && phase !== "busy";

  // Upsell-shown = the money moment (remaining hits 0) — once per mount.
  useEffect(() => {
    if (showUpsell && !upsellFiredRef.current) {
      upsellFiredRef.current = true;
      track("organizer_trial_upsell_shown", { remaining: 0 });
    }
  }, [showUpsell]);

  // "{n} of 5 free" progress line seen (per value that becomes visible).
  useEffect(() => {
    if ((phase === "form" || phase === "busy") && remainingNow > 0 && remainingNow < TRIAL_LIMIT && seenCountRef.current !== remainingNow) {
      seenCountRef.current = remainingNow;
      track("organizer_trial_count_view", { remaining: remainingNow });
    }
  }, [phase, remainingNow]);

  function patchCard(i: number, patch: Partial<FiledCard>) {
    setCards((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function applyStarter(chip: { label: string; text: string; description: string }) {
    setMode("text");
    setText(chip.text);
    setDescription(chip.description);
    setErr("");
    track("organizer_trial_chip", { label: chip.label });
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
    if (phase === "busy") return;
    setErr("");
    if (mode === "text") {
      if (!text.trim()) {
        setErr("Paste a message to file first.");
        return;
      }
    } else {
      if (!dataUrl) {
        setErr("Choose a screenshot or bill first.");
        return;
      }
      if (description.trim().length < 10) {
        setErr("Add a line about what this is (at least a few words) so we can file it honestly.");
        return;
      }
    }
    setPhase("busy");
    track("organizer_trial_started", { kind: mode, promo });
    const res = await runOrganizerTrial(
      {
        kind: mode,
        text: mode === "text" ? text.trim() : undefined,
        fileName: mode === "image" ? fileName : undefined,
        dataUrl: mode === "image" ? dataUrl : undefined,
        description: mode === "image" ? description.trim() : undefined,
      },
      promo
    );
    if (res.ok && res.result) {
      const nextTrial = res.trial || null;
      const suggestedTitle =
        res.result.title ||
        (mode === "text" ? text.trim().split("\n")[0].slice(0, 60) : fileName || "This item");
      const card: FiledCard = {
        folder: res.result.folder,
        category: res.result.category,
        reason: res.result.reason || "",
        title: suggestedTitle,
        localTitle: suggestedTitle,
        kept: false,
        editing: false,
      };
      setCards((prev) => [...prev, card]);
      setTrial(nextTrial);
      if (nextTrial?.count === 1) {
        setPulseIdx(0);
        setFirstFileMsg(true);
        track("organizer_first_file", {});
      }
      if (typeof nextTrial?.remaining === "number" && nextTrial.remaining === 0) {
        setPhase("blocked");
        setErr(USED_COPY);
      } else {
        setPhase("result");
      }
    } else {
      setErr(res.error || "Couldn't run the organizer demo right now — please try again.");
      setPhase(res.error && /5 free organizer trials/.test(res.error) ? "blocked" : "form");
    }
  }

  // Folder taxonomy chips (decorative preview of "where things go").
  const folderChips = TAXONOMY.filter((f) => f.slug !== "other");

  return (
    <section className="world world-desk mt-5 rounded-[2rem] border border-line bg-card p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-2">
        <IconOrganizer className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">The Organizer · Try it free</p>
      </div>
      <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Where would this go? Try it — five items, free.</h2>
      <p className="mt-2 text-base leading-relaxed text-stone">Paste a message from your co-parent, or upload a screenshot or a bill. We'll show you exactly where it belongs.</p>
      {phase === "form" && (
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2" aria-hidden="true">
          {folderChips.map((f) => (
            <span key={f.slug} className="chip shrink-0 select-none whitespace-nowrap text-sm">{f.label}</span>
          ))}
        </div>
      )}

      {/* Record Health teaser (spec §3a): the free dad sees the calm upsell card
          beside the trial — decorative grayed-out ring, no data, zero warning. */}
      <div className="mt-5">
        <RecordHealthTeaser onGoCommand={startCommandCheckout} />
      </div>

      {/* Growing stack of filed cards (D1) — visible across phases so the pile
          visibly shrinks in-session; nothing is saved, it resets on reload. */}
      {cards.length > 0 && (
        <div className="mt-6 space-y-3">
          {firstFileMsg && trial?.count === 1 && (
            <p className="text-base font-semibold text-forest">First one filed. The pile shrinks one paper at a time.</p>
          )}
          {cards.map((card, i) => (
            <div key={i} aria-live="polite" className={`rounded-3xl border border-forest/20 bg-cream-deep/60 p-6 ${i === pulseIdx ? "bys-trial-just-added" : ""}`}>
              <h3 className="font-display text-2xl font-semibold leading-snug text-forest">
                We'd file this under {folderLabel(card.folder)} › {subfolderLabel(card.folder, card.category)}
              </h3>
              {card.editing ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    value={card.localTitle}
                    onChange={(e) => patchCard(i, { localTitle: e.target.value })}
                    maxLength={200}
                    aria-label="Name for this item"
                    className="min-h-11 w-full max-w-sm rounded-full border border-line bg-cream px-4 py-2 text-base text-ink focus:border-forest-soft focus:outline-none"
                  />
                  <button onClick={() => patchCard(i, { editing: false, kept: true })} className="btn-primary min-h-11 px-4 text-base">Save name</button>
                  <button onClick={() => patchCard(i, { editing: false, localTitle: card.title })} className="btn-ghost min-h-11 px-4 text-base text-stone">Cancel</button>
                </div>
              ) : !card.kept ? (
                <p className="mt-2 text-base leading-relaxed text-ink">
                  Name it: <span className="font-semibold text-forest">{card.localTitle}</span> —{" "}
                  <button onClick={() => patchCard(i, { kept: true })} className="font-semibold text-forest underline underline-offset-4">keep</button>
                  {" / "}
                  <button onClick={() => patchCard(i, { editing: true })} className="font-semibold text-forest underline underline-offset-4">edit</button>
                </p>
              ) : null}
              <p className="mt-2 text-base leading-relaxed text-ink">{card.reason ? `Why: ${card.reason}` : "Filed under " + folderLabel(card.folder) + "."}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip border-forest bg-forest text-cream">{folderLabel(card.folder)}</span>
                <span className="chip border-line bg-card">{subfolderLabel(card.folder, card.category)}</span>
              </div>
              {card.folder === "other" && <p className="mt-4 rounded-2xl bg-card p-4 text-base leading-relaxed text-stone">{AMBIGUOUS_COPY}</p>}
            </div>
          ))}
          <p className="pt-2 text-sm leading-relaxed text-stone">This is a preview — nothing is saved or moved. You're the one who decides where it goes.</p>
        </div>
      )}

      {phase === "form" || phase === "busy" ? (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setMode("text"); setErr(""); }}
              className={`chip ${mode === "text" ? "border-forest bg-forest text-cream" : ""}`}
            >
              Paste a message
            </button>
            <button
              type="button"
              onClick={() => { setMode("image"); setErr(""); }}
              className={`chip ${mode === "image" ? "border-forest bg-forest text-cream" : ""}`}
            >
              Upload a screenshot or bill →
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Start with an example">
            {STARTER_CHIPS.map((c) => (
              <button key={c.label} type="button" onClick={() => applyStarter(c)} className="chip border-line bg-card text-forest">
                {c.label}
              </button>
            ))}
          </div>

          {mode === "text" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              maxLength={10000}
              placeholder="Paste a message from your co-parent…"
              className="mt-5 min-h-36 w-full resize-y rounded-2xl border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
            />
          ) : (
            <div className="mt-5">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-cream-deep px-4 py-2 text-base font-semibold text-forest transition hover:border-forest/40">
                {fileName ? <><IconCheck className="h-4 w-4" />{(fileName.length > 40 ? fileName.slice(0, 37) + "…" : fileName)}</> : <>Upload a screenshot or bill →</>}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
              {fileErr && <p role="alert" className="mt-3 text-base text-red-800">{fileErr}</p>}
              <label className="field-label mt-5" htmlFor="org-desc">What is this? <span className="font-normal text-stone">(required for images)</span></label>
              <textarea
                id="org-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Daycare bill for February, $380 — the receipt from the center"
                className="mt-2 w-full resize-y rounded-2xl border border-line bg-cream p-4 text-base leading-relaxed text-ink placeholder:text-taupe focus:border-forest-soft focus:outline-none"
              />
              <p className="mt-2 text-sm leading-relaxed text-stone">We file by what you tell us — add a line about what this is (we can't read the image itself yet).</p>
            </div>
          )}

          <button onClick={submit} disabled={phase === "busy"} className="btn-primary mt-5 w-full text-lg">
            {phase === "busy" ? "Filing it…" : "Show me where it goes"}
          </button>
          {phase === "busy" && (
            <p role="status" className="mt-4 flex items-center gap-2 text-base text-stone">
              <span className="bys-filing-dots flex items-center gap-1" aria-hidden="true">
                <span className="bys-dot h-1.5 w-1.5 rounded-full bg-forest-soft" />
                <span className="bys-dot h-1.5 w-1.5 rounded-full bg-forest-soft" />
                <span className="bys-dot h-1.5 w-1.5 rounded-full bg-forest-soft" />
              </span>
              Filing this paper…
            </p>
          )}
          {err && <p role="alert" className="mt-4 text-base text-red-800">{err}</p>}
          {remainingNow > 0 && remainingNow < TRIAL_LIMIT && (
            <p className="mt-4 text-base font-semibold text-forest">{remainingNow} of 5 free — look, your folders are forming</p>
          )}
          <p className="mt-4 text-sm leading-relaxed text-stone">Free trial — five items. Each one is only used to show where it belongs; nothing is saved yet.</p>
        </>
      ) : null}

      {phase === "result" && (
        <button onClick={() => { setPhase("form"); setErr(""); }} className="btn-ghost mt-5 w-full text-forest">
          File another paper →
        </button>
      )}

      {phase === "blocked" && (
        <div aria-live="polite" className="mt-6 rounded-3xl border border-line bg-cream-deep/60 p-6">
          <p className="text-base leading-relaxed text-ink">{err}</p>
        </div>
      )}

      {showUpsell && !upsellDeclined ? (
        <div className="mt-6 rounded-3xl border border-forest/25 bg-forest p-6 text-cream">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-cream/70">Five down — the pile shrinks one paper at a time.</p>
          <h3 className="mt-3 font-display text-2xl font-semibold leading-snug">The rest of your case, in one calm place.</h3>
          <p className="mt-3 text-base leading-relaxed text-cream/85">Command Center is coming together — and the Document Organizer you just tried is already live and working. Messages, screenshots, bills, school and medical papers — filed and findable in seconds. No filing nights.</p>
          <ul className="mt-4 space-y-2 text-base text-cream/90">
            <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-cream/70" /><span>Generous document storage — hundreds of files, comfortably enough for a full case</span></li>
            <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-cream/70" /><span>Organized + searchable — every item tagged, everything findable</span></li>
            <li className="flex items-start gap-2"><IconCheck className="mt-1 h-4 w-4 shrink-0 text-cream/70" /><span>Export pack — included. Your full record — reviews, log, timeline, documents, case summary — downloads as one clean file, ready to take with you.</span></li>
          </ul>
          <button onClick={startCommandCheckout} className="btn-primary mt-5 w-full bg-cream text-forest hover:bg-cream-deep">
            See Command Center — $12.49/mo
          </button>
          <p className="mt-4 text-sm leading-relaxed text-cream/75">Command Center is live — Document Organizer, Case Summary, and Action Center are built. Cancel anytime · Annual: $124.90 (10 months billed) · Everything in Command Center is included in Ultimate Co-Parent</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <a href="/pricing" className="min-h-11 text-base font-semibold text-cream underline decoration-cream/50 underline-offset-4">See all plans →</a>
            <button onClick={() => setUpsellDeclined(true)} className="min-h-11 text-base text-cream/70 hover:text-cream">No thanks — I'll keep the free plan</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
