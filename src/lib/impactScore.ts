// Message Impact Score (calm-loop slice 1) — a deterministic, honest score
// (0–100) computed ONLY from the review's own structured output (the blocks
// array): flagged conflict risks, flagged phrases, and preserved facts. No
// hidden model, no magic number. The label reads tone/conflict, never an
// outcome prediction (the honesty footer in the UI is mandatory).
//
// Zero dependencies by design: imported by the client (ReviewResults.tsx,
// home.tsx, DidYouSendIt.tsx) AND the server (server-api.ts review-events
// handler). The block shape is structural — identical to ResultBlock from
// ReviewResults.tsx but defined locally so this module stays import-free.

export type ScoreLabel = "Calm" | "Fairly calm" | "Heated" | "High conflict signals";

export type ImpactFlags = {
  risks: number;     // item count in the "risks" section
  watchout: number;  // item count in the "watchout" section
  facts: number;     // item count in the "facts" section
  movedBy: string[]; // 1–2 short human sentences explaining the score
};

export type ImpactBlock =
  | { kind: "item"; id: string; text: string }
  | { kind: "section"; id: string; title: string }
  | { kind: "para"; id: string; text: string }
  | { kind: "rewrite"; id: string; title: string }
  | { kind: "rwtext"; id: string; text: string };

// Exact math (documented, locked — do not tune without a spec change):
//   baseline 85
//   −9 per risk item, capped at −36 (4+ risk items all count −36)
//   −6 per watchout item, capped at −30 (5+ items all count −30)
//   +2 per fact item, capped at +6 (3+ items all count +6)
//   clean-message floor: if risks === 0 && watchout === 0 → score ≥ 90
//   clamp to [5, 100], round to integer
// Sanity numbers (must hold):
//   (3 risks, 4 watchout, 1 fact) → 36 · High conflict signals
//   (0/0/2)                       → 90 · Calm
//   (1 risk, 1 watchout, 2 facts) → 74 · Fairly calm
export function computeImpactScore(blocks: ImpactBlock[]): { score: number; label: ScoreLabel; flags: ImpactFlags } {
  let risks = 0;
  let watchout = 0;
  let facts = 0;
  for (const b of blocks) {
    if (b.kind !== "item") continue;
    if (b.id === "risks") risks++;
    else if (b.id === "watchout") watchout++;
    else if (b.id === "facts") facts++;
  }

  let score = 85;
  score -= Math.min(risks, 4) * 9;
  score -= Math.min(watchout, 5) * 6;
  score += Math.min(facts, 3) * 2;
  if (risks === 0 && watchout === 0) score = Math.max(score, 90);
  score = Math.max(5, Math.min(100, Math.round(score)));

  let label: ScoreLabel;
  if (score >= 85) label = "Calm";
  else if (score >= 65) label = "Fairly calm";
  else if (score >= 45) label = "Heated";
  else label = "High conflict signals";

  const movedBy: string[] = [];
  if (risks === 0 && watchout === 0) {
    movedBy.push("No conflict flags — reads calm and clear.");
  } else {
    // First-match priority: at least one of risks/watchout is > 0 here.
    if (risks > 0) movedBy.push(`${risks} conflict risk${risks === 1 ? "" : "s"} flagged`);
    if (watchout > 0) movedBy.push(`${watchout} phrase${watchout === 1 ? "" : "s"} flagged`);
    // ("Facts worth preserving kept it factual." only applies when no
    // risk/warning is present — which is the branch above; max 2 lines.)
  }

  return { score, label, flags: { risks, watchout, facts, movedBy } };
}
