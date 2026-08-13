// "Case Summary" — calm upgrade card shown to Free and Steady users on the
// Case Summary tab. Honest, one step at a time: what it is, where it lives
// (Command Center), and one clear path forward. No fake claims, no urgency.

import { IconBook } from "./icons";

const SAMPLE_CHIPS = ["Log", "Timeline", "Documents", "Saved reviews"];

export default function CaseSummaryLocked({ tier }: { tier: string }) {
  const planName = tier === "steady" ? "Steady" : "Free";
  return (
    <section className="mt-5 rounded-[2rem] border border-line bg-card p-6 shadow-card sm:p-8">
      <div className="flex items-center gap-2">
        <IconBook className="h-5 w-5 text-forest-soft" />
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Case Summary</p>
      </div>
      <h2 className="mt-3 font-display text-3xl font-semibold text-forest">Your situation, at a glance.</h2>
      <p className="mt-2 text-base leading-relaxed text-stone">
        One calm page from what you've saved — the dates, people, and patterns in your record. No legal advice, ever.
      </p>

      <div className="mt-5 flex flex-wrap gap-2" aria-hidden="true">
        {SAMPLE_CHIPS.map((c) => (
          <span key={c} className="chip select-none whitespace-nowrap text-sm">{c}</span>
        ))}
      </div>

      <div className="mt-6 rounded-3xl border border-forest/20 bg-cream-deep/60 p-6">
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-forest-soft">Part of Command Center</p>
        <p className="mt-2 text-base leading-relaxed text-ink">
          The Case Summary is part of Command Center — {tier === "steady" ? "everything in Steady, plus" : "everything, including"} the Document Organizer, Communication Log, Event Timeline, and your saved reviews.
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
