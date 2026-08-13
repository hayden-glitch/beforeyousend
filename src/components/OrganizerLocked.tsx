import { useState } from "react";
import { IconOrganizer } from "./icons";
const SAMPLE_FOLDERS = ["Communication", "Finances"];
// Locked view for Free/Steady dads (no Organizer access yet). §3d of the
// organizer-expansion spec: the Sort My Pile enticement — primary "Sort a pile
// once — $19.50", secondary "Or Command Center — $12.49/mo, unlimited filing",
// quiet "Not now" that leaves a session chip ("Your pile is set aside — pick it
// up whenever."). Only rendered when the dad has NO Organizer access, so
// sortUntil/Command/Ultimate dads never see it (full experience, no prompts).
export default function OrganizerLocked({ tier, onSortPile }: { tier: string; onSortPile: () => void }) {
  const [pileDismissed, setPileDismissed] = useState(false);
  const planName = tier === "steady" ? "Steady" : "Free";
  return (
    <section className="mt-5 rounded-[2rem] border border-line bg-card p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-2">
        <IconOrganizer className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">The Organizer</p>
      </div>
      <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Every paper, in one calm place.</h2>
      <p className="mt-2 text-base leading-relaxed text-stone">
        Files messages, screenshots, bills, and school records the moment you drop them in —
        tagged and findable in seconds.
      </p>
      <div className="mt-5 flex flex-wrap gap-2" aria-hidden="true">
        {SAMPLE_FOLDERS.map((f) => (
          <span key={f} className="chip select-none whitespace-nowrap text-sm">{f}</span>
        ))}
        <span className="chip select-none whitespace-nowrap text-sm">Health &amp; Medical</span>
        <span className="chip select-none whitespace-nowrap text-sm">Legal &amp; Court</span>
        <span className="chip select-none whitespace-nowrap text-sm">…and more</span>
      </div>
      <div className="mt-6 rounded-3xl border border-line bg-cream-deep/60 p-6">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Sort My Pile</p>
        <p className="mt-2 text-base leading-relaxed text-ink">
          Got a pile? Sort My Pile files up to 50 documents into your Organizer folders for you — no subscription, one time.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button onClick={onSortPile} className="btn-primary">Sort a pile once — $19.50</button>
          <a href="/pricing" className="btn-ghost text-forest">Or Command Center — $12.49/mo, unlimited filing</a>
        </div>
        {pileDismissed ? (
          <p className="mt-4 text-base leading-relaxed text-stone">
            Your pile is set aside — pick it up whenever.{" "}
            <button onClick={() => setPileDismissed(false)} className="font-semibold text-forest underline underline-offset-4">Sort it now →</button>
          </p>
        ) : (
          <button onClick={() => setPileDismissed(true)} className="mt-4 text-sm text-stone underline underline-offset-4">Not now</button>
        )}
      </div>
      <div className="mt-6 rounded-3xl border border-forest/20 bg-cream-deep/60 p-6">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Part of Command Center</p>
        <p className="mt-2 text-base leading-relaxed text-ink">
          The Organizer is part of Command Center — {tier === "steady" ? "everything in Steady, plus" : "everything, including"} generous document storage (hundreds of files), the Communication Log, the Event Timeline, and more.
        </p>
        <a href="/pricing" className="btn-primary mt-5 w-full text-lg sm:w-auto">
          See Command Center →
        </a>
        <p className="mt-4 text-sm leading-relaxed text-stone">
          $12.49/mo · Cancel anytime · You're on the {planName} plan right now — no change until you choose.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-stone">
          Command Center is live — all four tools are built.
        </p>
      </div>
    </section>
  );
}
