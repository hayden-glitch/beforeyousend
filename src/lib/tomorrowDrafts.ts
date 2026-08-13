// 11pm Lamp drafts — device-local by design. The lamp's "Save it for tomorrow"
// stores the raw draft on THIS device only (localStorage), so the honesty line
// "It's on this device" is exactly true, saving never touches a review credit,
// and there is no server row, DDL, or purge surface. All functions degrade
// silently (try/catch) — a draft save must never break the page. Cap 20 is a
// real, honest on-device shelf (never surfaced as a warning — same rule as the
// 5-free reviews); same text moves to the top instead of duplicating.
export type TomorrowDraft = { id: string; text: string; savedAt: string };
const KEY = "bys_tomorrow_drafts";
const MAX = 20; // real cap, honest: on-device shelf, not an archive

export function isLateNight(d: Date): boolean { const h = d.getHours(); return h >= 22 || h < 5; }

export function readTomorrowDrafts(): TomorrowDraft[] {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x && typeof x.id === "string" && typeof x.text === "string" && typeof x.savedAt === "string");
  } catch { return []; }
}
export function addTomorrowDraft(text: string): TomorrowDraft[] {
  const t = (text || "").trim(); if (!t) return readTomorrowDrafts();
  const rest = readTomorrowDrafts().filter((d) => d.text !== t); // same text → move to top, never duplicate
  const next = [{ id: crypto.randomUUID(), text: t, savedAt: new Date().toISOString() }, ...rest].slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full/unavailable — nothing else to do */ }
  return next;
}
export function removeTomorrowDraft(id: string): TomorrowDraft[] {
  const next = readTomorrowDrafts().filter((d) => d.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
