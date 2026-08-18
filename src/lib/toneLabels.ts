// Single source of truth for tone display labels (calm-loop slices 1-2).
// Keys: the bys_log.tone ids written by the did-you-send one-tap loop
// (gentle|direct|firm|as-wrote|reviewed) plus the manual Add/Edit form's
// "neutral" pick. Consumers: home.tsx (log suffix + chips), DigestCard.tsx
// (tone mix), DidYouSendIt.tsx keeps its ToneKey-typed subset.
export const TONE_DISPLAY: Record<string, string> = {
  gentle: "Gentle",
  direct: "Direct",
  firm: "Firm but Neutral",
  "as-wrote": "My message",
  reviewed: "Reviewed",
  neutral: "Neutral",
};
