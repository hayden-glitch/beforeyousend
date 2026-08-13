// FolderRatings — the Ratings paper in the opened child's folder (Design 1).
// TWO layers, both real, both grounded in the app's own data:
//  1. Dad's weekly Exchange Tone rating — a one-tap 3-choice self-report
//     (Calm 🌿 / Mixed 🌤 / Stormy 🌧), stored per child id per ISO week.
//  2. Tone tally — computed from Communication Log entries the dad tagged
//     with this child (log.child === child.id); chips expand the entries.
// Honesty: it is his own record — "a snapshot, not a prediction or legal
// assessment" footer is always visible.

import { useCallback, useEffect, useMemo, useState } from "react";
import { track } from "~/lib/analytics";
import { TONE_DISPLAY } from "~/lib/toneLabels";
import { patchProfile, type ProfilePatch } from "./FolderOpenPanel";
import type { ChildInfo } from "./ChildFolder";

const RATING_CHOICES: { value: "calm" | "mixed" | "stormy"; label: string }[] = [
  { value: "calm", label: "Calm 🌿" },
  { value: "mixed", label: "Mixed 🌤" },
  { value: "stormy", label: "Stormy 🌧" },
];
const RATING_LABEL: Record<string, string> = { calm: "Calm", mixed: "Mixed", stormy: "Stormy" };
// Tone tally chips: the five dad-facing tones from the log (reviewed is the
// auto-log provenance, not a dad-facing tone — excluded from the tally).
const TALLY_TONES = ["gentle", "direct", "firm", "neutral", "as-wrote"] as const;

/** ISO week key YYYY-Www (the dad's rating is per calendar week). */
export function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function FolderRatings({
  child,
  tier,
  profile,
  onProfilePatch,
  onGoLog,
}: {
  child: ChildInfo;
  tier: string;
  profile: unknown;
  onProfilePatch: ProfilePatch;
  onGoLog: () => void;
}) {
  const childId = child.id || child.name;
  const week = isoWeekKey();
  const profileObj = (profile || {}) as Record<string, unknown>;
  const ratings = ((profileObj.weekRatings as Record<string, Record<string, string>> | undefined) || {})[childId] || {};
  const thisWeek: string | undefined = ratings[week];

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Tone tally — /api/log rows tagged with this child. A failed read shows
  // nothing (honest empty state), never an error card.
  const [logs, setLogs] = useState<unknown[] | null>(null);
  const loadLogs = useCallback(async () => {
    try {
      const r = await fetch("/api/log");
      if (r.ok) setLogs((await r.json()).logs || []);
    } catch {
      setLogs([]);
    }
  }, []);
  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const tagged = useMemo(
    () => (logs || []).filter((x: any) => x?.child === childId),
    [logs, childId]
  );
  const tally = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of TALLY_TONES) {
      const n = tagged.filter((x: any) => x.tone === t).length;
      if (n > 0) m[t] = n;
    }
    return m;
  }, [tagged]);
  const tallyTones = TALLY_TONES.filter((t) => tally[t] > 0);
  const [openTone, setOpenTone] = useState<string | null>(null);
  const openRows = useMemo(
    () => (openTone ? tagged.filter((x: any) => x.tone === openTone) : []),
    [tagged, openTone]
  );

  async function setRating(value: "calm" | "mixed" | "stormy") {
    if (saving) return;
    setSaving(true);
    setErr("");
    const res = await patchProfile({ weekRating: { child: childId, week, value } }, onProfilePatch);
    setSaving(false);
    if (res.ok) {
      track("folder_rating_set", { plan: tier, week, value });
    } else {
      setErr(res.error);
    }
  }

  return (
    <section className="flex h-full flex-col">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Ratings</p>
      <h3 className="mt-1 font-display text-2xl font-semibold leading-snug text-forest">
        How the exchanges are going.
      </h3>

      {/* Week card — one tap sets. */}
      <div className="mt-4 rounded-2xl border border-line bg-cream-deep/50 p-4">
        <p className="text-base font-semibold text-forest">This week</p>
        <p className="mt-1 text-base leading-relaxed text-stone">
          How's the week going, overall? Your own rating — for you.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`This week's tone for ${child.name}`}>
          {RATING_CHOICES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setRating(c.value)}
              disabled={saving}
              aria-pressed={thisWeek === c.value}
              className={`chip min-h-11 ${thisWeek === c.value ? "border-forest bg-forest text-cream" : ""}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        {thisWeek ? (
          <p className="mt-3 text-base text-forest">
            This week: {RATING_LABEL[thisWeek]} <span className="text-stone">· Tap to change</span>
          </p>
        ) : (
          <p className="mt-3 text-base text-stone">No rating yet — one tap when you're ready.</p>
        )}
        {err && <p role="alert" className="mt-2 text-base text-red-800">{err}</p>}
      </div>

      {/* Tone tally — from the dad's tagged log entries. */}
      <div className="mt-4 rounded-2xl border border-line bg-cream-deep/50 p-4">
        <p className="text-base font-semibold text-forest">Tone of exchanges about {child.name}</p>
        <p className="mt-1 text-base leading-relaxed text-stone">
          From the exchanges you've logged and tagged.
        </p>
        {tallyTones.length === 0 ? (
          <div className="mt-3">
            <p className="text-base leading-relaxed text-ink">No exchanges tagged to {child.name} yet.</p>
            <p className="mt-1 text-base leading-relaxed text-stone">
              Tag one in the Communication Log and it shows up here.
            </p>
            <button onClick={onGoLog} className="mt-3 min-h-11 text-base font-semibold text-forest underline underline-offset-4">
              Open the Communication Log →
            </button>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {tallyTones.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    const next = openTone === t ? null : t;
                    setOpenTone(next);
                    if (next) track("folder_tone_chip_tap", { plan: tier, tone: t });
                  }}
                  aria-expanded={openTone === t}
                  className={`chip min-h-11 ${openTone === t ? "border-forest bg-forest text-cream" : ""}`}
                >
                  {TONE_DISPLAY[t]} · {tally[t]}
                </button>
              ))}
            </div>
            {openTone && openRows.length > 0 && (
              <div className="mt-3 space-y-2">
                {openRows.map((x: any) => (
                  <div key={x.id} className="rounded-2xl border border-line bg-card p-3">
                    <p className="line-clamp-2 text-base leading-relaxed text-ink">{x.message}</p>
                    <p className="mt-1 text-sm text-stone">
                      {x.direction === "sent" ? "Sent by me" : "Received"} ·{" "}
                      {new Date(x.date).toLocaleDateString()}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <p className="mt-auto pt-4 text-sm leading-relaxed text-stone">
        Your record and your own rating — a snapshot, not a prediction or legal assessment.
      </p>
    </section>
  );
}
