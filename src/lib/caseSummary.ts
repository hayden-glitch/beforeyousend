// Case Summary client lib — GET loads the persisted summary (or null) with the
// current record counts; POST generates/regenerates it from the user's OWN
// saved data (Communication Log, Event Timeline, Organizer documents, saved
// reviews). Command Center tier feature — the server enforces the gate (402,
// same as the Document Organizer). No "AI" in user copy.

export type CaseSummaryCounts = { log: number; timeline: number; docs: number; reviews: number };
export type CaseSummaryRow = { text: string; generatedAt: string; dataVersion: string };
export type CaseSummaryData = { summary: CaseSummaryRow | null; counts: CaseSummaryCounts; empty?: boolean; fallback?: boolean };
export type CaseSummaryApiResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

async function csFetch(path: string, init?: RequestInit): Promise<CaseSummaryApiResult<unknown>> {
  let r: Response;
  try {
    r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    return { ok: false, error: "Couldn't reach the Case Summary right now — please try again." };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = typeof j?.error === "string" ? j.error : "Couldn't reach the Case Summary right now — please try again.";
    if (r.status === 402) return { ok: false, error: "The Case Summary is part of the Command Center plan." };
    if (r.status === 401) return { ok: false, error: "Please sign in again." };
    return { ok: false, error: msg };
  }
  return { ok: true, value: j };
}

export async function fetchCaseSummary(): Promise<CaseSummaryApiResult<CaseSummaryData>> {
  const r = await csFetch("/api/case-summary");
  return r.ok ? { ok: true, value: r.value as CaseSummaryData } : r;
}

export async function generateCaseSummary(): Promise<CaseSummaryApiResult<CaseSummaryData>> {
  const r = await csFetch("/api/case-summary", { method: "POST" });
  return r.ok ? { ok: true, value: r.value as CaseSummaryData } : r;
}
