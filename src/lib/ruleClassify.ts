// Deterministic rule-based organizer classifier — SHARED CLIENT-SAFE LIB.
// Single source of truth for the no-LLM fallback path: imported by BOTH the
// server (server-api.ts — Organizer fallback + Sort My Pile rule path) and the
// landing "Sort one thing free" demo. Zero drift: behavior is byte-identical
// to the old module-private definitions. No node builtins, no fetch, no
// imports beyond ./taxonomy — safe to bundle on the client and run on SSR.

import { folderBySlug } from "./taxonomy";

export type RuleHit = {
  folder: string;
  category: string;
};

export type OrganizerRuleResult = {
  folder: string;
  category: string;
  reason: string;
  summary: string;
  tags: string[];
};

// Deterministic fallback classifier — the demo never hard-fails. Order per
// spec §2: money → finances, health → health, school → school, legal → legal,
// schedule → schedule, else communication/texts-and-emails.
// Shared deterministic folder map — THE map both the Organizer fallback and
// Sort My Pile use (one map, never two). Returns null when nothing matches
// (Sort My Pile surfaces that as "needs sorting"; the Organizer fallback keeps
// its old default of communication/texts-and-emails).
export function ruleFolderFor(text: string): RuleHit | null {
  const t = String(text || "").toLowerCase();
  if (/child support|reimburs/.test(t)) return { folder: "finances", category: "child-support" };
  if (/invoice|bill|receipt|daycare|tuition|payment/.test(t)) return { folder: "finances", category: "receipts" };
  if (/\$\d/.test(t)) return { folder: "finances", category: "shared-expenses" };
  if (/doctor|clinic|medication|prescri|dentist|therapy|pediatrician/.test(t)) return { folder: "health", category: "records" };
  if (/school|teacher|report card|iep|504|homework|parent-teacher/.test(t)) return { folder: "school", category: "communications" };
  if (/court|attorney|lawyer|filing|petition|mediation|custody evaluat|court order|parenting order|custody order|restraining order|court hearing|custody hearing|final hearing|hearing date/.test(t)) return { folder: "legal", category: "orders-and-agreements" };
  if (/pickup|drop.?off|exchange|schedule|friday|weekend/.test(t)) return { folder: "schedule", category: "pickup-dropoff" };
  return null;
}

// Record Health missing-doc scan — 4-folder map (organizer-expansion spec §1,
// Slice 1). ALIGNED to the tightened ruleFolderFor keywords above (P1 hardening
// 5794297): bare appointment / hearing / order traps are GONE — "I love hearing
// the kids laugh" must never map to Legal. Used by BOTH GET /api/record-health
// and the Action Center fallback (fallbackActionItems) — one map, never two.
// "expense|reimburse|cost of|child support" are safe money phrases (kept from
// the spec's original map + ruleFolderFor's child-support rule); health/legal
// regexes are byte-identical to the tightened ruleFolderFor phrases.
export type MissingDocRule = { folder: string; label: string; re: RegExp };
export const RECORD_HEALTH_MISSING_RULES: MissingDocRule[] = [
  { folder: "finances", label: "Finances", re: /bill|invoice|receipt|daycare|tuition|payment|expense|reimburse|cost of|child support/i },
  { folder: "health", label: "Health & Medical", re: /doctor|clinic|medication|prescri|dentist|therapy|pediatrician/i },
  { folder: "school", label: "School & Education", re: /school|teacher|report card|iep|504|homework|parent-teacher/i },
  { folder: "legal", label: "Legal & Court", re: /court|attorney|lawyer|filing|petition|mediation|custody evaluat|court order|parenting order|custody order|restraining order|court hearing|custody hearing|final hearing|hearing date/i },
];

export function fallbackOrganizerClassify(text: string): OrganizerRuleResult {
  var t = String(text || "").toLowerCase();
  var label = function (slug: string) { return (folderBySlug(slug) || { label: slug }).label; };
  var pick = function (folderSlug: string, categorySlug: string) { return { folder: folderSlug, category: categorySlug, reason: "Filed by rule — this looked like " + label(folderSlug) + ".", summary: "Filed by rule under " + label(folderSlug) + " — worth a quick check of the details.", tags: [folderSlug, categorySlug, "needs-check"] }; };
  var hit = ruleFolderFor(t);
  if (hit) return pick(hit.folder, hit.category);
  return pick("communication", "texts-and-emails");
}
